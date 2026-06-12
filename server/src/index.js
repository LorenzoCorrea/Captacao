import express from 'express';
import searchRouter from './routes/search.js';

const app = express();
app.use(express.json());
app.use(searchRouter);

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`API de captação ouvindo em http://localhost:${PORT}`);
});
