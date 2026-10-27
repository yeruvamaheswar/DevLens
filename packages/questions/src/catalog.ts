import type { Catalog, CatalogOption, Category, Ecosystem } from './types';

// Versioned package -> option map. Exact names only. No I/O.

type Packages = Partial<Record<Ecosystem, string[]>>;

function option(id: string, name: string, category: Category, packages: Packages = {}): CatalogOption {
  return { id, name, category, packages };
}

export const CATALOG: Catalog = {
  version: '2026-10-27.1',
  categories: {
    ui_framework: 'UI framework',
    meta_framework: 'Meta-framework',
    python_web_framework: 'Python web framework',
    node_web_framework: 'Node web framework',
    database: 'Database',
    orm: 'ORM',
    test_framework: 'Test framework',
    state_management: 'State management',
  },
  options: [
    option('react', 'React', 'ui_framework', { npm: ['react', 'react-dom'] }),
    option('vue', 'Vue', 'ui_framework', { npm: ['vue'] }),
    option('angular', 'Angular', 'ui_framework', { npm: ['@angular/core', '@angular/common'] }),
    option('svelte', 'Svelte', 'ui_framework', { npm: ['svelte'] }),
    option('solid', 'Solid', 'ui_framework', { npm: ['solid-js'] }),

    option('next', 'Next.js', 'meta_framework', { npm: ['next'] }),
    option('nuxt', 'Nuxt', 'meta_framework', { npm: ['nuxt'] }),
    option('sveltekit', 'SvelteKit', 'meta_framework', { npm: ['@sveltejs/kit'] }),
    option('remix', 'Remix', 'meta_framework', { npm: ['@remix-run/react', '@remix-run/node', '@remix-run/serve'] }),
    option('astro', 'Astro', 'meta_framework', { npm: ['astro'] }),

    option('fastapi', 'FastAPI', 'python_web_framework', { pypi: ['fastapi'] }),
    option('flask', 'Flask', 'python_web_framework', { pypi: ['flask'] }),
    option('django', 'Django', 'python_web_framework', { pypi: ['django'] }),

    option('express', 'Express', 'node_web_framework', { npm: ['express'] }),
    option('fastify', 'Fastify', 'node_web_framework', { npm: ['fastify'] }),
    option('nestjs', 'NestJS', 'node_web_framework', { npm: ['@nestjs/core', '@nestjs/common'] }),
    option('hono', 'Hono', 'node_web_framework', { npm: ['hono'] }),

    option('postgresql', 'PostgreSQL', 'database', {
      npm: ['pg', 'postgres'],
      pypi: ['psycopg', 'psycopg2', 'psycopg2-binary', 'asyncpg'],
    }),
    option('mysql', 'MySQL', 'database', {
      npm: ['mysql2', 'mysql'],
      pypi: ['pymysql', 'mysqlclient', 'mysql-connector-python'],
    }),
    option('sqlite', 'SQLite', 'database', { npm: ['better-sqlite3', 'sqlite3'], pypi: ['aiosqlite'] }),
    option('mongodb', 'MongoDB', 'database', { npm: ['mongodb', 'mongoose'], pypi: ['pymongo', 'motor'] }),
    option('supabase', 'Supabase', 'database', {
      npm: ['@supabase/supabase-js', 'supabase'],
      pypi: ['supabase'],
    }),

    option('prisma', 'Prisma', 'orm', { npm: ['prisma', '@prisma/client'] }),
    option('drizzle', 'Drizzle', 'orm', { npm: ['drizzle-orm', 'drizzle-kit'] }),
    option('sqlalchemy', 'SQLAlchemy', 'orm', { pypi: ['sqlalchemy'] }),
    option('typeorm', 'TypeORM', 'orm', { npm: ['typeorm'] }),

    option('vitest', 'Vitest', 'test_framework', { npm: ['vitest'] }),
    option('jest', 'Jest', 'test_framework', { npm: ['jest'] }),
    option('node-test', 'node:test', 'test_framework'),
    option('pytest', 'pytest', 'test_framework', { pypi: ['pytest'] }),

    option('redux', 'Redux', 'state_management', { npm: ['redux', 'react-redux', '@reduxjs/toolkit'] }),
    option('zustand', 'Zustand', 'state_management', { npm: ['zustand'] }),
    option('jotai', 'Jotai', 'state_management', { npm: ['jotai'] }),
    option('pinia', 'Pinia', 'state_management', { npm: ['pinia'] }),
  ],
};
