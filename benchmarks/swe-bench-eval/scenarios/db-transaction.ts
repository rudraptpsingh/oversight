/**
 * Scenario 3: Database Transaction Handler
 *
 * Real-world pattern: PostgreSQL transaction management
 * Constraints built incrementally from real production incidents
 */

export const ORIGINAL_CODE = `
import { Pool, PoolClient } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export async function createOrder(
  userId: string,
  items: OrderItem[]
): Promise<{ orderId: string }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, status, total) VALUES ($1, $2, $3) RETURNING id',
      [userId, 'pending', items.reduce((sum, i) => sum + i.price * i.quantity, 0)]
    );

    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [orderId, item.productId, item.quantity, item.price]
      );

      await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2',
        [item.quantity, item.productId]
      );
    }

    await client.query('COMMIT');
    return { orderId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
`;

// Mutation A: No rollback on error
export const MUTATION_A = `
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

// "Simplified" - removed try/catch complexity
export async function createOrder(
  userId: string,
  items: OrderItem[]
): Promise<{ orderId: string }> {
  const client = await pool.connect();

  await client.query('BEGIN');

  const orderResult = await client.query(
    'INSERT INTO orders (user_id, status, total) VALUES ($1, $2, $3) RETURNING id',
    [userId, 'pending', items.reduce((sum, i) => sum + i.price * i.quantity, 0)]
  );

  const orderId = orderResult.rows[0].id;

  for (const item of items) {
    await client.query(
      'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
      [orderId, item.productId, item.quantity, item.price]
    );

    await client.query(
      'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2',
      [item.quantity, item.productId]
    );
  }

  await client.query('COMMIT');
  client.release();

  return { orderId };
}
`;

// Mutation B: Release before rollback (connection leak on error)
export const MUTATION_B = `
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export async function createOrder(
  userId: string,
  items: OrderItem[]
): Promise<{ orderId: string }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, status, total) VALUES ($1, $2, $3) RETURNING id',
      [userId, 'pending', items.reduce((sum, i) => sum + i.price * i.quantity, 0)]
    );

    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [orderId, item.productId, item.quantity, item.price]
      );

      await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2',
        [item.quantity, item.productId]
      );
    }

    await client.query('COMMIT');
    return { orderId };
  } catch (err) {
    // "Fixed order" - release then rollback
    client.release(); // WRONG ORDER: releases before rollback
    await client.query('ROLLBACK'); // Client already released!
    throw err;
  }
}
`;

// Mutation C: Inventory update without checking for negative stock
export const MUTATION_C = `
import { Pool, PoolClient } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export async function createOrder(
  userId: string,
  items: OrderItem[]
): Promise<{ orderId: string }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, status, total) VALUES ($1, $2, $3) RETURNING id',
      [userId, 'pending', items.reduce((sum, i) => sum + i.price * i.quantity, 0)]
    );

    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [orderId, item.productId, item.quantity, item.price]
      );

      // "Performance optimization" - skip inventory check, just decrement
      await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2',
        [item.quantity, item.productId]
      );
    }

    await client.query('COMMIT');
    return { orderId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
`;

// Mutation D: Correct - proper transaction with rollback, release in finally, inventory check
export const MUTATION_D = `
import { Pool, PoolClient } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export async function createOrder(
  userId: string,
  items: OrderItem[]
): Promise<{ orderId: string }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, status, total) VALUES ($1, $2, $3) RETURNING id',
      [userId, 'pending', items.reduce((sum, i) => sum + i.price * i.quantity, 0)]
    );

    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [orderId, item.productId, item.quantity, item.price]
      );

      // Atomic decrement with stock check
      const inventoryResult = await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND quantity >= $1 RETURNING quantity',
        [item.quantity, item.productId]
      );

      if (inventoryResult.rowCount === 0) {
        throw new Error(\`Insufficient inventory for product \${item.productId}\`);
      }
    }

    await client.query('COMMIT');
    return { orderId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
`;

// Mutation E: missing BEGIN — each query auto-commits, no atomicity
export const MUTATION_E = `
import { Pool, PoolClient } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export async function createOrder(
  userId: string,
  items: OrderItem[]
): Promise<{ orderId: string }> {
  const client = await pool.connect();

  try {
    // Missing BEGIN — each query auto-commits independently
    const orderResult = await client.query(
      'INSERT INTO orders (user_id, status, total) VALUES ($1, $2, $3) RETURNING id',
      [userId, 'pending', items.reduce((sum, i) => sum + i.price * i.quantity, 0)]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      const inventoryResult = await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND quantity >= $1 RETURNING quantity',
        [item.quantity, item.productId]
      );
      if (inventoryResult.rowCount === 0) {
        throw new Error(\`Insufficient inventory for product \${item.productId}\`);
      }
    }

    return { orderId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
`;

// Mutation F: rowCount not checked after inventory UPDATE (oversell goes undetected)
export const MUTATION_F = `
import { Pool, PoolClient } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export async function createOrder(
  userId: string,
  items: OrderItem[]
): Promise<{ orderId: string }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, status, total) VALUES ($1, $2, $3) RETURNING id',
      [userId, 'pending', items.reduce((sum, i) => sum + i.price * i.quantity, 0)]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      // rowCount never checked — 0-row UPDATE (zero stock) silently succeeds
      await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND quantity >= $1',
        [item.quantity, item.productId]
      );
    }

    await client.query('COMMIT');
    return { orderId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
`;

// Mutation G: pool created without connectionTimeoutMillis (indefinite waits under load)
export const MUTATION_G = `
import { Pool, PoolClient } from 'pg';

// No connectionTimeoutMillis — pool.connect() waits forever under slow-query load
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export async function createOrder(
  userId: string,
  items: OrderItem[]
): Promise<{ orderId: string }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, status, total) VALUES ($1, $2, $3) RETURNING id',
      [userId, 'pending', items.reduce((sum, i) => sum + i.price * i.quantity, 0)]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      const inventoryResult = await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND quantity >= $1 RETURNING quantity',
        [item.quantity, item.productId]
      );
      if (inventoryResult.rowCount === 0) {
        throw new Error(\`Insufficient inventory for product \${item.productId}\`);
      }
    }

    await client.query('COMMIT');
    return { orderId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
`;

export const PHASE_1_CONSTRAINTS: string[] = [];

export const PHASE_2_CONSTRAINTS = [
  `
CONSTRAINT (added after data corruption incident 2023-05-12):
  MUST call client.release() inside finally block, not in try or catch.
  On exception, if release() is in the try block it never runs.
  Connection stays open forever → connection pool exhaustion → full outage.
  Incident: 200 stuck transactions drained the pool in 3 minutes.
  See: INCIDENT-POOL-EXHAUSTION-2023.md
  `
];

export const PHASE_3_CONSTRAINTS = [
  ...PHASE_2_CONSTRAINTS,
  `
CONSTRAINT (added after negative inventory incident 2024-02-20):
  MUST check inventory availability atomically in the same UPDATE.
  Use: UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND quantity >= $1
  Non-atomic check+decrement allows overselling under concurrent load.
  Incident: 300 orders created for 50 units of stock during flash sale.
  See: INCIDENT-OVERSELL-2024.md
  `,
  `
CONSTRAINT (added after data corruption incident 2023-05-12):
  MUST call ROLLBACK in the catch block before releasing the connection.
  Order: catch → ROLLBACK → finally → release.
  Without ROLLBACK, partially-written rows remain committed (data corruption).
  See: INCIDENT-POOL-EXHAUSTION-2023.md
  `
];
