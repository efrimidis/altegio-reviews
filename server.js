require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = `https://api.alteg.io/api/v1/comments/${process.env.ALTEGIO_COMPANY_ID}`;
const TOKEN = `Bearer ${process.env.ALTEGIO_BEARER_TOKEN},${process.env.ALTEGIO_USER_TOKEN}`;

const formatDate = (str) => str.split(' ')[0];

const cors = require('cors');
app.use(cors());

let cachedReviews = null;
let lastFetchTime = 0;

app.get('/altegio-reviews', async (req, res) => {
  const now = Date.now();
  const cacheTTL = 10 * 60 * 1000; // 10 минут

  if (cachedReviews && (now - lastFetchTime) < cacheTTL) {
    return res.json(cachedReviews);
  }

  try {
    const response = await fetch(`${API_URL}?count=20`, {
      headers: {
        'Authorization': TOKEN,
        'Accept': 'application/vnd.api.v2+json',
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();
    if (!result.success) return res.status(502).json({ error: 'Altegio error', details: result });

    const filtered = result.data
      .filter(r => r.text && r.text.trim().length > 0)
      .map(r => ({
        name: r.user_name,
        text: r.text.trim(),
        date: r.date.split(' ')[0],
        rating: r.rating
      }));

    cachedReviews = filtered;
    lastFetchTime = now;

    res.json(filtered);
  } catch (error) {
    console.error('Ошибка при запросе к Altegio:', error);
    res.status(500).json({ error: 'Ошибка при получении отзывов' });
  }
});

app.listen(PORT, () => console.log(`Сервер слушает порт ${PORT}`));
