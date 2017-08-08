The [**Onion Routed Cloud**](https://orc.network). ORC is a distributed 
anonymous cloud storage network owned and operated by _all of us_. Join 
the discussion in `#orc` on our [community chat](https://matrix.counterpointhackers.org/_matrix/client/#/room/#orc:matrix.counterpointhackers.org)!

[![Build Status](https://img.shields.io/travis/orcproject/orc.svg?style=flat-square)](https://travis-ci.org/orcproject/orc) | 
[![Test Coverage](https://img.shields.io/coveralls/orcproject/orc.svg?style=flat-square)](https://coveralls.io/r/orcproject/orc) | 
[![Node Package](https://img.shields.io/npm/v/@orcproject/orc.svg?style=flat-square)](https://www.npmjs.com/package/@orcproject/orc) | 
[![Docker Hub](https://img.shields.io/docker/pulls/orcproject/orc.svg?style=flat-square)](https://hub.docker.com/r/orcproject/orc) | 
[![License (AGPL-3.0)](https://img.shields.io/badge/license-AGPL3.0-blue.svg?style=flat-square)](https://raw.githubusercontent.com/orcproject/orc/master/LICENSE)

### Quick Start

Pull the [image from Docker Hub](https://hub.docker.com/r/orcproject/orc/).

```
docker pull orcproject/orc
```

Create a data directory on the host.

```
mkdir ~/.config/orc
```

Run the ORC container and mount the data directory.

```
docker run -v ~/.config/orc:/root/.config/orc -t orcproject/orc:latest
```

> If running Docker for Windows, use the UNC formatted path: 
> `\\machine\driveletter\.config\orc:/root/.config/orc`.

Modify the created configuration at `~/.config/orc/config` as desired (see 
the {@tutorial config}) and restart the container for the changes to take 
effect. You might wish to expose the ports defined for `ControlPort`, 
`BridgePort`, `DirectoryPort`, and `DashboardPort` to the host (and update 
their corresponding `*Hostname` to `0.0.0.0`) and map them to the host.

```
docker run \
  --publish 127.0.0.1:4444:4444 \
  --publish 127.0.0.1:4445:4445 \
  --publish 127.0.0.1:4446:4446 \
  --publish 127.0.0.1:8080:8080 \
  --volume ~/.config/orc:/root/.config/orc \
  --tty orcproject/orc:latest
```

> See the [`docker run` documentation](https://docs.docker.com/engine/reference/commandline/run/) 
> for more information. If you prefer to install ORC manually, see the guide for 
> {@tutorial install}. Once installed, simply run `orc` with an optional 
> configuration file using the `--config <path/to/config>` option.

Once the container has started, you can navigate in your browser to 
`http://127.0.0.1:8080` to access your node's dashboard!

### Development 

To hack on the ORC project, clone this repository and use 
[Docker Compose](https://docs.docker.com/compose/):

```
docker-compose up
```

This will volume mount the `lib` and `test` directories for development, and 
then boots up the ORC container. Happy hacking!

> **Note!** If you are exposing services from the docker container to the host
> you _must_ set the services `*Hostname` property to `0.0.0.0` in your ORC 
> configuration!

### Resources

* [Documentation](https://orcproject.github.io/orc/)
* [Specification](https://raw.githubusercontent.com/orcproject/whitepaper/master/protocol.pdf)
* [Whitepaper](https://raw.githubusercontent.com/orcproject/whitepaper/master/whitepaper.pdf)

### License

ORC - Distributed Anonymous Cloud  
Copyright (C) 2017  Counterpoint Hackerspace, Ltd.  

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see
[http://www.gnu.org/licenses/](http://www.gnu.org/licenses/).
