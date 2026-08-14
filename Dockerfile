FROM node:18-alpine

WORKDIR /app

# Install dependencies first for better cache
COPY package*.json ./
RUN npm ci --only=production

# Copy app sources
COPY . .

# Create unprivileged user
RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app
USER app

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
