const express = require('express');
const app = express();
const http = require('http').createServer(app);
const WebSocket = require('ws');

const wss = new WebSocket.Server({ server: http });

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
    <button onclick="enviar(1)">LIGAR</button>
    <button onclick="enviar(0)">DESLIGAR</button>

    <script>
      let ws = new WebSocket("wss://" + location.host);

      function enviar(cmd){
        ws.send(cmd);
      }
    </script>
  `);
});

http.listen(3000, () => {
    console.log("Servidor rodando em http://localhost:3000");
});