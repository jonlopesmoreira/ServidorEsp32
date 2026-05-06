const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

let comando = "0";

wss.on('connection', (ws) => {
    console.log("Cliente conectado");

    ws.send(comando);

    ws.on('message', (msg) => {
        comando = msg.toString();

        console.log("Novo comando:", comando);

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(comando);
            }
        });
    });
});

app.get('/', (req, res) => {
    res.send(`
    <h1>Controle ESP32</h1>
    <button onclick="enviar('1')">LIGAR</button>
    <button onclick="enviar('0')">DESLIGAR</button>

    <script>
      let ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);

      function enviar(cmd){
        ws.send(cmd);
      }
    </script>
  `);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Servidor rodando na porta " + PORT);
});