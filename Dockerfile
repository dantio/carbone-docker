FROM node:16-bullseye-slim

ENV LO_VER=7.2.7.2

WORKDIR /tmp
RUN set -xe \
  && apt-get update \
  && apt-get -y --no-install-recommends install ca-certificates wget libxinerama1 libfontconfig1 libdbus-glib-1-2 libcairo2 libcups2 libglu1-mesa libsm6 \
  && apt-get purge -y --auto-remove \
  && wget https://downloadarchive.documentfoundation.org/libreoffice/old/${LO_VER}/deb/x86_64/LibreOffice_${LO_VER}_Linux_x86-64_deb.tar.gz \
  && tar -zxvf LibreOffice_${LO_VER}_Linux_x86-64_deb.tar.gz

RUN dpkg -i ./LibreOffice_*_Linux_x86-64_deb/DEBS/*.deb && rm -rf LibreOffice_*_Linux_x86-64_deb.tar.gz ./LibreOffice_*_Linux_x86-64_deb

# install node package
RUN mkdir -p /home/node/carbone-api/node_modules && chown -R node:node /home/node/carbone-api
WORKDIR /home/node/carbone-api
COPY package.json package-lock.json ./
USER node
RUN npm ci
COPY --chown=node:node . .

# run HTTP API server by default
EXPOSE 3030
CMD node index
USER root