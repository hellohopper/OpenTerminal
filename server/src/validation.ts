import {z} from 'zod';
export const symbolSchema=z.string().trim().toUpperCase().regex(/^(?=.*[A-Z0-9])[A-Z0-9.^=&-]{1,20}$/);
