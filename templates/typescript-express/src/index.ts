/**
 * TypeScript Express API Starter Template
 * Ready for AI-assisted development
 */
import express, { Request, Response } from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

interface Item {
  id: number;
  name: string;
  description?: string;
}

const items = new Map<number, Item>();
let nextId = 1;

app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'TypeScript Express API is running' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/items', (_req: Request, res: Response) => {
  res.json([...items.values()]);
});

app.get('/items/:id', (req: Request, res: Response) => {
  const item = items.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.post('/items', (req: Request, res: Response) => {
  const item: Item = { id: nextId++, ...req.body };
  items.set(item.id, item);
  res.status(201).json(item);
});

app.put('/items/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!items.has(id)) return res.status(404).json({ error: 'Not found' });
  const item: Item = { id, ...req.body };
  items.set(id, item);
  res.json(item);
});

app.delete('/items/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!items.has(id)) return res.status(404).json({ error: 'Not found' });
  items.delete(id);
  res.json({ message: 'Deleted' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
