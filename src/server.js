const app = require("./app");
require('./db/init')();

const PORT = process.env.PORT || 4000;

const renderWorker = require("./workers/renderWorker");

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  renderWorker.startWorker();
});
