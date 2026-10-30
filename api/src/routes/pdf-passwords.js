/**
 * Remembered PDF passwords (D336), for Settings → Privacy: the list (who or
 * what each is for and how often it's opened a statement, never the
 * password), add one, and forget one.
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../core/validate.js';
import { listPasswords, rememberPassword, forgetPassword } from '../statements/pdf-passwords.js';

export const pdfPasswordsRouter = Router();

const addSchema = z.object({ password: z.string().min(1).max(200), label: z.string().trim().max(60).nullable().optional() });

pdfPasswordsRouter.get('/', async (req, res, next) => {
  try { res.json(await listPasswords()); } catch (err) { next(err); }
});

pdfPasswordsRouter.post('/', validate(addSchema), async (req, res, next) => {
  try { res.status(201).json({ id: await rememberPassword(req.body.password, req.body.label || null, { opened: false }) }); } catch (err) { next(err); }
});

pdfPasswordsRouter.delete('/:id', async (req, res, next) => {
  try {
    if (!(await forgetPassword(Number(req.params.id)))) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
