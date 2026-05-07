const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

app.use(express.static('public'));

const wss = new WebSocket.Server({ server });

let comando = "0";

function comandoValido(cmd) {
  if (cmd === "0") return true;
  const partes = cmd.split(":");
  if (partes.length !== 2) return false;
  const dir = partes[0];
  const vel = parseInt(partes[1], 10);
  return (dir === "1" || dir === "2") && vel >= 0 && vel <= 255;
}

function descricaoComando(cmd) {
  if (cmd === "0") return "PARAR";
  const [dir, vel] = cmd.split(":");
  const nome = dir === "1" ? "FRENTE" : "RE";
  return `${nome} velocidade=${vel}`;
}

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const agente = req.headers['user-agent'] || 'desconhecido';
  const isEsp32 = agente.toLowerCase().includes('esp') || !agente.toLowerCase().includes('mozilla');

  ws.clientId = ip;
  ws.clientTipo = isEsp32 ? 'ESP32' : 'Navegador';

  console.log(`Cliente conectado [${ws.clientTipo}] IP: ${ip}`);

  ws.send(comando);

  ws.on('message', (msg) => {
    const recebido = msg.toString().trim();

    if (!comandoValido(recebido)) {
      console.log("Comando invalido ignorado:", recebido);
      return;
    }

    comando = recebido;

    console.log(`Novo comando: ${comando} - ${descricaoComando(comando)} (enviado por [${ws.clientTipo}] ${ws.clientId})`);

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(comando);
      }
    });
  });

  ws.on('close', () => {
    console.log(`Cliente desconectado [${ws.clientTipo}] IP: ${ws.clientId}`);
  });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Controle ESP32</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <main class="painel">
          <section class="topo">
            <div id="conexao" class="conexao">Conectando</div>
          </section>

          <section class="status">
            <article class="bloco">
              <span class="rotulo">Estado atual</span>
              <p id="estadoAtual" class="valor">Carregando...</p>
            </article>
            <article class="bloco">
              <span class="rotulo">Ultimo comando</span>
              <p id="ultimoComando" class="valor">Nenhum</p>
            </article>
          </section>

          <section class="acoes">
            <button id="btnFrente" class="ligar" onclick="enviar('1')">FRENTE</button>
            <button id="btnParar" class="desligar" onclick="enviar('0')">PARAR</button>
            <button id="btnRe" class="re" onclick="enviar('2')">RE</button>
          </section>

          <div class="velocidade">
            <div class="velocidade-topo">
              <span class="rotulo" style="margin:0">Velocidade</span>
              <span class="velocidade-valor" id="velValor">78%</span>
            </div>
            <input type="range" id="slider" min="0" max="100" value="78"
              oninput="atualizarSlider(this.value)" />
          </div>

          <p class="dica">O painel recebe atualizacoes em tempo real. Se outro cliente enviar um comando, o estado exibido aqui muda automaticamente.</p>
        </main>

        <script>
          const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
          const conexao = document.getElementById("conexao");
          const estadoAtual = document.getElementById("estadoAtual");
          const ultimoComando = document.getElementById("ultimoComando");
          const btnFrente = document.getElementById("btnFrente");
          const btnParar = document.getElementById("btnParar");
          const btnRe = document.getElementById("btnRe");
          const slider = document.getElementById("slider");
          const velValor = document.getElementById("velValor");

          let velocidade = 0; // PWM real (30-255)

          function pwmDePercent(pct) {
            return Math.round(30 + (pct / 100) * (255 - 30));
          }

          function atualizarSlider(v) {
            const pct = parseInt(v, 10);
            slider.value = pct;
            velocidade = pwmDePercent(pct);
            velValor.textContent = pct + '%';
            slider.style.setProperty('--pct', pct + '%');
          }
          atualizarSlider(slider.value);

          function textoComando(cmd) {
            if (cmd === "0") return "PARAR";
            const [dir, vel] = cmd.split(":");
            const nome = dir === "1" ? "FRENTE" : "RE";
            return vel ? nome + " (" + vel + ")" : nome;
          }

          function atualizarEstado(cmd) {
            const ativo = cmd !== "0";
            const dir = cmd.split(":")[0];

            estadoAtual.textContent = textoComando(cmd);
            estadoAtual.className = "valor " + (ativo ? "ativo" : "inativo");
            ultimoComando.textContent = textoComando(cmd);
            ultimoComando.className = "valor " + (ativo ? "ativo" : "inativo");

            btnFrente.classList.toggle("botao-ativo", dir === "1");
            btnParar.classList.toggle("botao-ativo", cmd === "0");
            btnRe.classList.toggle("botao-ativo", dir === "2");
          }

          function definirConexao(status, texto) {
            conexao.className = "conexao " + status;
            conexao.textContent = texto;
            const indisponivel = status !== "online";
            btnFrente.disabled = indisponivel;
            btnParar.disabled = indisponivel;
            btnRe.disabled = indisponivel;
            slider.disabled = indisponivel;
          }

          ws.addEventListener("open", () => {
            definirConexao("online", "Conectado");
          });

          ws.addEventListener("message", (event) => {
            atualizarEstado(event.data.toString());
          });

          ws.addEventListener("close", () => {
            definirConexao("offline", "Desconectado");
          });

          ws.addEventListener("error", () => {
            definirConexao("offline", "Erro de conexao");
          });

          function enviar(cmd) {
            if (ws.readyState !== WebSocket.OPEN) {
              return;
            }

            const payload = cmd === "0" ? "0" : cmd + ":" + velocidade;
            ws.send(payload);
            atualizarEstado(payload);
          }

          definirConexao("", "Conectando");
        </script>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
  console.log("http://localhost:" + PORT);
});