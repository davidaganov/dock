/** @type {Set<import('http').ServerResponse>} */
const sseClients = new Set()

const addSseClient = (res) => {
  sseClients.add(res)
}

const removeSseClient = (res) => {
  sseClients.delete(res)
}

const broadcast = (event, data) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    try {
      client.write(payload)
    } catch {
      // Drop disconnected SSE clients instead of failing the whole broadcast.
      sseClients.delete(client)
    }
  }
}

module.exports = { addSseClient, removeSseClient, broadcast }
