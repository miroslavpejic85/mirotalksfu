FROM buildpack-deps:bullseye

# Versions of Nginx and nginx-rtmp-module to use
ENV NGINX_VERSION=1.24.0
ENV NGINX_RTMP_MODULE_VERSION=1.2.2

# Install dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    openssl \
    libssl-dev \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Download and decompress Nginx and RTMP module
RUN mkdir -p /tmp/build && \
    cd /tmp/build && \
    wget https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz && \
    tar -zxf nginx-${NGINX_VERSION}.tar.gz && \
    wget https://github.com/arut/nginx-rtmp-module/archive/v${NGINX_RTMP_MODULE_VERSION}.tar.gz && \
    tar -zxf v${NGINX_RTMP_MODULE_VERSION}.tar.gz

# Build and install Nginx with RTMP module
RUN cd /tmp/build/nginx-${NGINX_VERSION} && \
    ./configure \
        --sbin-path=/usr/local/sbin/nginx \
        --conf-path=/etc/nginx/nginx.conf \
        --error-log-path=/var/log/nginx/error.log \
        --pid-path=/var/run/nginx/nginx.pid \
        --lock-path=/var/lock/nginx/nginx.lock \
        --http-log-path=/var/log/nginx/access.log \
        --http-client-body-temp-path=/tmp/nginx-client-body \
        --with-http_ssl_module \
        --with-threads \
        --with-ipv6 \
        --add-module=/tmp/build/nginx-rtmp-module-${NGINX_RTMP_MODULE_VERSION} \
        --with-debug && \
    make -j $(getconf _NPROCESSORS_ONLN) && \
    make install && \
    mkdir /var/lock/nginx && \
    rm -rf /tmp/build

# Forward logs to Docker
RUN ln -sf /dev/stdout /var/log/nginx/access.log && \
    ln -sf /dev/stderr /var/log/nginx/error.log

# ------------------------
# FROM tiangolo/nginx-rtmp
# ------------------------

# Copy nginx.conf with RTMP configuration and stat.xsl
COPY nginx.conf /etc/nginx/nginx.conf
COPY stat.xsl /usr/share/nginx/html/stat.xsl

# Rtmp port
EXPOSE 1935
# Http port
EXPOSE 8081

CMD ["nginx", "-g", "daemon off;"]
