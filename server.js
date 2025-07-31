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

app.get('/altegio-reviews', async (req, res) => {
  try {
    const response = await fetch(`${API_URL}?count=10`, {
      headers: {
        'Authorization': TOKEN,
        'Accept': 'application/vnd.api.v2+json',
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (!result.success) {
      return res.status(502).json({ error: 'Ошибка в ответе Altegio', details: result });
    }

    const filtered = result.data
      .filter(r => r.text && r.text.trim().length > 0)
      .map(r => ({
        name: r.user_name,
        text: r.text.trim(),
        date: formatDate(r.date),
        rating: r.rating
      }));

    res.status(200).json(filtered);
  } catch (error) {
    console.error('Ошибка при получении отзывов:', error);
    res.status(500).json({ error: 'Ошибка при получении отзывов' });
  }
});

app.listen(PORT, () => console.log(`Сервер слушает порт ${PORT}`));
