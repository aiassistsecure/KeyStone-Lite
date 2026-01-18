/**
 * Express API Starter Template
 * Ready for AI-assisted development
 */
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const items = new Map();
let nextId = 1;

app.get('/', (req, res) => {
  res.json({ message: 'Express API is running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/items', (req, res) => {
  res.json([...items.values()]);
});

app.get('/items/:id', (req, res) => {
  const item = items.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.post('/items', (req, res) => {
  const item = { id: nextId++, ...req.body };
  items.set(item.id, item);
  res.status(201).json(item);
});

app.put('/items/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!items.has(id)) return res.status(404).json({ error: 'Not found' });
  const item = { id, ...req.body };
  items.set(id, item);
  res.json(item);
});

app.delete('/items/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!items.has(id)) return res.status(404).json({ error: 'Not found' });
  items.delete(id);
  res.json({ message: 'Deleted' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
