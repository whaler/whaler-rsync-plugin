'use strict';

module.exports = exports;
module.exports.__cmd = cmd;

/**
 * @param whaler
 */
function exports(whaler) {

    require('./listeners/rsync')(whaler);
    require('./listeners/daemon')(whaler);
    require('./listeners/kill')(whaler);

}

/**
 * @param whaler
 */
function cmd(whaler) {

    require('./commands/rsync')(whaler);
    require('./commands/daemon')(whaler);
    require('./commands/kill')(whaler);

}
