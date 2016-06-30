# Whaler rsync plugin

## Install

```sh
$ whaler plugins:install whaler-rsync-plugin
```

## Usage

Sync files from current dir to remote machine

```sh
$ whaler rsync . <app>@<domain name or IP>
```

Sync files from remote machine to current dir

```sh
$ whaler rsync <app>@<domain name or IP> .
```

Sync single file from current dir to remote machine

```sh
$ whaler rsync ./file.txt <app>@<domain name or IP>
```

Sync single file from remote machine to current dir

```sh
$ whaler rsync <app>@<domain name or IP>:/file.txt ./
```

Sync to remote machine servive

```sh
$ whaler rsync . <service>.<app>@<domain name or IP>:/var/www
```

Sync from remote machine service

```sh
$ whaler rsync <service>.<app>@<domain name or IP>:/var/www ./
```

## License

This software is under the MIT license. See the complete license in:

```
LICENSE
```
