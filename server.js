require('dotenv').config();

const app = require('./src/index');
const { migrate } = require('./src/config/migrate');

const PORT = process.env.PORT || 3000;

migrate()
  .catch((err) => {
    console.error('Migration failed:', err);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });
