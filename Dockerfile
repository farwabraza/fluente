# FLUENTE — container image (for Google Cloud Run, Northflank, or any Docker host)
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
ENV NODE_ENV=production
# Cloud Run injects PORT; server.js already reads process.env.PORT
EXPOSE 3000
CMD ["node", "server.js"]
