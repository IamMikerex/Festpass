const app = require('./app');
const config = require('./config');
const jobs = require('./jobs');

app.listen(config.port, () => {
  console.log(`FestPass API listening on http://localhost:${config.port}`);
  jobs.start();
});
