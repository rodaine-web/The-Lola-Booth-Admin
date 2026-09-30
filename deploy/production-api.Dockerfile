FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY public/brand ./public/brand
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "npm run db:migrate && node server/src/scripts/bootstrap-production-owner.js && npm start"]
