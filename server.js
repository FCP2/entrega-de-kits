require('dotenv').config();
const app = require('./app');

const port = Number(process.env.PORT) || 8001;
app.listen(port, () => console.log(`Control de kits: http://localhost:${port}`));
