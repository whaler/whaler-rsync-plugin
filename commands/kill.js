'use strict';

module.exports = exports;

/**
 * @param whaler
 */
function exports(whaler) {

    whaler.get('cli')
        .command('rsync:kill <container>')
        //.alias('rsync-kill')
        .description('Kill rsync daemon', {
            container: 'Rsync container name'
        })
        .action(function* (container, options) {
            yield whaler.$emit('rsync:kill', {
                container: container
            });
        })._noHelp = true;

}
