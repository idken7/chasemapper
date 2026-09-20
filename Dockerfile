# -------------------
# The build container
# -------------------
FROM python:3.11-bookworm AS build

# Upgrade base packages.
RUN apt-get update && \
  apt-get upgrade -y && \
  apt-get install -y \
  cmake \
  curl \
  libgeos-dev \
  libatlas-base-dev && \
  rm -rf /var/lib/apt/lists/*

# Copy in existing wheels.
COPY wheel[s]/ /root/.cache/pip/wheels/

# No wheels might exist.
RUN mkdir -p /root/.cache/pip/wheels/

# Copy in requirements.txt.
COPY requirements.txt /root/chasemapper/requirements.txt

# Install Python packages system-wide (not --user): the final stage runs as
# a non-root user (see below) whose $HOME differs from this build stage's,
# and /root itself is 0700 (root-only traversal) so a --user install under
# /root/.local would be entirely unreachable there regardless of file
# permissions. /usr/local/lib/python3.11/site-packages is on the default
# sys.path and, unlike /root, actually traversable by any user.
RUN pip3 install --break-system-packages --no-warn-script-location \
  --ignore-installed -r /root/chasemapper/requirements.txt

# Copy in chasemapper.
COPY . /root/chasemapper

# Download and install cusf_predictor_wrapper, and build predictor binary.
ADD https://github.com/darksidelemm/cusf_predictor_wrapper/archive/master.zip \
  /root/cusf_predictor_wrapper-master.zip
RUN unzip /root/cusf_predictor_wrapper-master.zip -d /root && \
  rm /root/cusf_predictor_wrapper-master.zip && \
  mkdir -p /root/cusf_predictor_wrapper-master/src/build && \
  cd /root/cusf_predictor_wrapper-master/src/build && \
  cmake .. && \
  make

# Self-host Cesium's browser build instead of pulling it from a CDN at
# request time - the map (templates/index.html) needs to keep working when a
# chase vehicle has no signal to reach a CDN. CESIUM_VERSION must match the
# version templates/index.html expects (window.CESIUM_BASE_URL etc).
ARG CESIUM_VERSION=1.126.0
RUN mkdir -p /root/chasemapper/static/vendor/cesium && \
  curl -sL https://registry.npmjs.org/cesium/-/cesium-${CESIUM_VERSION}.tgz | \
  tar -xz -C /root/chasemapper/static/vendor/cesium --strip-components=3 package/Build/Cesium

# -------------------------
# The application container
# -------------------------
FROM python:3.11-bookworm
EXPOSE 5001/tcp

# Upgrade base packages and install application dependencies.
RUN apt-get update && \
  apt-get upgrade -y && \
  apt-get install -y \
  libeccodes0 \
  libgeos-c1v5 \
  libglib2.0-0 \
  libatlas3-base \
  libgfortran5 \
  tini && \
  rm -rf /var/lib/apt/lists/*

# Run as a non-root user. UID/GID 1000 matches the default first-user account
# on Debian/Ubuntu/Raspberry Pi OS (this project's documented deployment
# target), so bind-mounted host directories (./gfs, ./horusmapper.cfg - see
# docker-compose.yml) are writable without extra host-side chown steps for
# the common single-user-Pi case. Override via docker-compose.yml's `user:`
# field if your host's primary user has a different UID.
RUN groupadd -g 1000 chasemapper && \
  useradd -u 1000 -g chasemapper -m chasemapper

# Copy the pip-installed packages from the build container's system-wide
# site-packages (see the pip3 install comment above for why not --user).
COPY --from=build /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages

# Copy predictor binary from the build container.
COPY --from=build /root/cusf_predictor_wrapper-master/src/build/pred \
  /opt/chasemapper/

# Copy the self-hosted Cesium build from the build container.
COPY --from=build /root/chasemapper/static/vendor/cesium \
  /opt/chasemapper/static/vendor/cesium

# Copy in chasemapper.
COPY . /opt/chasemapper

# Own the app directory (and the predictor binary/Cesium assets copied above)
# as the non-root user. The pip-installed packages under /usr/local stay
# root-owned, which is fine - they're on the default system-wide
# site-packages path and world-readable there (unlike /root, see above).
RUN chown -R chasemapper:chasemapper /opt/chasemapper

# Set the working directory.
WORKDIR /opt/chasemapper

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5001/', timeout=3)" || exit 1

USER chasemapper

# Use tini as init.
ENTRYPOINT ["/usr/bin/tini", "--"]

# Run horusmapper.py.
CMD ["python3", "/opt/chasemapper/horusmapper.py"]
