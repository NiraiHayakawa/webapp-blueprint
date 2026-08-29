import { z } from "zod";

export const placeOrderSchema = z.object({ id: z.string() });
