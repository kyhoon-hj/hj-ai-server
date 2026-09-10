FROM node:24-alpine
ENV NODE_ENV=production
ENV DEMO_HOST=0.0.0.0
WORKDIR /app
COPY config/standard-ports.mjs ./config/standard-ports.mjs
COPY --chown=node:node demo ./demo
RUN mkdir -p /app/demo/reports && chown node:node /app/demo/reports
USER node
EXPOSE 11001
CMD ["node", "demo/server.mjs"]
