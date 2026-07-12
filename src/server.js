const app = require("./app");
require('./db/init')();

const PORT = process.env.PORT || 4000;

const worker = require("./workers/renderWorker");

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  worker.startWorker();
});
