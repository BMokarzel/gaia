import express from 'express';

const app = express();
app.use(express.json());

app.get('/users', async (req, res) => {
  res.json([]);
});

app.get('/users/:id', async (req, res) => {
  res.json({ id: req.params.id });
});

app.post('/users', async (req, res) => {
  res.status(201).json(req.body);
});

app.put('/users/:id', async (req, res) => {
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/users/:id', async (req, res) => {
  res.status(204).send();
});

export default app;
