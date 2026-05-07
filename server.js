const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

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
        <style>
          :root {
            color-scheme: light;
            --bg-top: #f6efe4;
            --bg-bottom: #dcecf2;
            --card: rgba(255, 255, 255, 0.88);
            --card-border: rgba(55, 84, 170, 0.14);
            --text: #19324a;
            --muted: #5c7286;
            --green: #1f9d55;
            --green-strong: #157347;
            --red: #e14b4b;
            --red-strong: #b93737;
            --blue: #2f6fed;
            --shadow: 0 24px 60px rgba(23, 43, 77, 0.16);
            --radius: 28px;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            font-family: "Trebuchet MS", "Segoe UI", sans-serif;
            color: var(--text);
            background:
              radial-gradient(circle at top left, rgba(255, 255, 255, 0.9), transparent 34%),
              radial-gradient(circle at bottom right, rgba(47, 111, 237, 0.15), transparent 30%),
              linear-gradient(160deg, var(--bg-top), var(--bg-bottom));
          }

          .painel {
            width: min(100%, 760px);
            padding: clamp(24px, 5vw, 40px);
            border-radius: var(--radius);
            border: 1px solid var(--card-border);
            background: var(--card);
            backdrop-filter: blur(12px);
            box-shadow: var(--shadow);
          }

          .topo {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 28px;
          }

          h1 {
            margin: 0;
            font-size: clamp(2rem, 4vw, 3.2rem);
            line-height: 0.95;
            letter-spacing: 0.04em;
          }

          .subtitulo {
            margin: 10px 0 0;
            font-size: 1rem;
            color: var(--muted);
            max-width: 38ch;
          }

          .conexao {
            flex-shrink: 0;
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 12px 16px;
            border-radius: 999px;
            background: rgba(25, 50, 74, 0.08);
            color: var(--text);
            font-weight: 700;
          }

          .conexao::before {
            content: "";
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #f0b429;
            box-shadow: 0 0 0 4px rgba(240, 180, 41, 0.16);
          }

          .conexao.online::before {
            background: var(--green);
            box-shadow: 0 0 0 4px rgba(31, 157, 85, 0.18);
          }

          .conexao.offline::before {
            background: var(--red);
            box-shadow: 0 0 0 4px rgba(225, 75, 75, 0.16);
          }

          .status {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
            margin-bottom: 22px;
          }

          .bloco {
            padding: 18px 20px;
            border-radius: 22px;
            background: rgba(255, 255, 255, 0.75);
            border: 1px solid rgba(25, 50, 74, 0.08);
          }

          .rotulo {
            display: block;
            margin-bottom: 8px;
            font-size: 0.82rem;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: var(--muted);
          }

          .valor {
            margin: 0;
            font-size: clamp(1.3rem, 3vw, 2rem);
            font-weight: 800;
          }

          .valor.ativo {
            color: var(--green-strong);
          }

          .valor.inativo {
            color: var(--red-strong);
          }

          .acoes {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
          }

          .velocidade {
            margin-top: 20px;
            padding: 18px 20px;
            border-radius: 22px;
            background: rgba(255, 255, 255, 0.75);
            border: 1px solid rgba(25, 50, 74, 0.08);
          }

          .velocidade-topo {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
          }

          .velocidade-valor {
            font-size: 1.4rem;
            font-weight: 800;
            color: var(--blue);
          }

          input[type=range] {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 10px;
            border-radius: 999px;
            background: linear-gradient(to right, var(--blue) 0%, var(--blue) var(--pct, 59%), rgba(25,50,74,0.12) var(--pct, 59%), rgba(25,50,74,0.12) 100%);
            outline: none;
            cursor: pointer;
          }

          input[type=range]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: var(--blue);
            box-shadow: 0 4px 12px rgba(47,111,237,0.35);
            cursor: pointer;
            transition: transform 0.15s;
          }

          input[type=range]::-webkit-slider-thumb:active {
            transform: scale(1.2);
          }

          button {
            appearance: none;
            border: 0;
            border-radius: 24px;
            min-height: 132px;
            padding: 22px;
            font: inherit;
            font-size: clamp(1.1rem, 2.6vw, 1.45rem);
            font-weight: 800;
            letter-spacing: 0.08em;
            color: #fff;
            cursor: pointer;
            transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
            box-shadow: 0 18px 32px rgba(25, 50, 74, 0.18);
          }

          button:hover {
            transform: translateY(-2px);
          }

          button:active {
            transform: translateY(1px) scale(0.99);
          }

          button:disabled {
            cursor: not-allowed;
            opacity: 0.6;
            transform: none;
          }

          .ligar {
            background: linear-gradient(135deg, #31bf71, #188c4f);
          }

          .re {
            background: linear-gradient(135deg, #5b87ff, #2f5ee3);
          }

          .desligar {
            background: linear-gradient(135deg, #f06b6b, #c93939);
          }

          .botao-ativo {
            outline: 4px solid rgba(47, 111, 237, 0.22);
            outline-offset: 3px;
          }

          .dica {
            margin: 18px 0 0;
            color: var(--muted);
            font-size: 0.95rem;
          }

          @media (max-width: 640px) {
            body {
              padding: 14px;
            }

            .topo,
            .status,
            .acoes {
              grid-template-columns: 1fr;
              display: grid;
            }

            .topo {
              margin-bottom: 20px;
            }

            .conexao {
              justify-self: start;
            }

            button {
              min-height: 110px;
            }
          }
        </style>
      </head>
      <body>
        <main class="painel">
          <section class="topo">
            <div>
              <h1>Controle ESP32</h1>
              <p class="subtitulo">Acione o dispositivo com botões maiores, leitura clara do estado atual e boa usabilidade tanto no desktop quanto no smartphone.</p>
            </div>
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
              <span class="velocidade-valor" id="velValor">200</span>
            </div>
            <input type="range" id="slider" min="40" max="255" value="200"
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

          let velocidade = 200;

          function atualizarSlider(v) {
            velocidade = parseInt(v, 10);
            velValor.textContent = velocidade;
            const pct = ((velocidade - 40) / (255 - 40) * 100).toFixed(1);
            slider.style.setProperty('--pct', pct + '%');
          }
          atualizarSlider(200);

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