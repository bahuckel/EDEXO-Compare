"use strict";
/**
 * ED Exo Compare only uses express.static + JSON routes, not res.render().
 * Express's real view.js does require(engineName) dynamically; pkg warns because
 * it cannot see those modules at compile time. This stub removes that pattern.
 */
function View() {
  throw new Error("Template rendering is not used in ED Exo Compare.");
}
module.exports = View;
