'use strict';

module.exports = exports;
module.exports.__cmd = cmd;

/**
 * @param whaler
 */
async function exports (whaler) {

    await require('./listeners/rsync')(whaler);
    await require('./listeners/daemon')(whaler);
    await require('./listeners/kill')(whaler);

}

/**
 * @param whaler
 */
async function cmd (whaler) {

    await require('./commands/rsync')(whaler);
    await require('./commands/daemon')(whaler);
    await require('./commands/kill')(whaler);

}
