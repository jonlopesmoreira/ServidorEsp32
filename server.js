const express = require('express');
const http = require('http');
const os = require('os');
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

    if (recebido.startsWith('{')) {
      try {
        const payload = JSON.parse(recebido);
        if (payload.type === 'wifiConnect') {
          const ssid = String(payload.ssid || '').trim();
          const senha = String(payload.password || '');
          if (!ssid) {
            ws.send(JSON.stringify({ type: 'wifiResult', ok: false, error: 'SSID vazio' }));
            return;
          }
          const cmd = `WIFI_CFG|${encodeURIComponent(ssid)}|${encodeURIComponent(senha)}`;
          let enviados = 0;
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.clientTipo === 'ESP32') {
              client.send(cmd);
              enviados++;
            }
          });
          ws.send(JSON.stringify({ type: 'wifiResult', ok: enviados > 0, targets: enviados }));
          console.log(`WIFI_CFG enviado para ${enviados} ESP32. SSID: ${ssid}`);
          return;
        }
      } catch (_) { }
    }

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

app.get('/esp-discovery', (req, res) => {
  res.type('text/plain').send('ESP_SERVER_OK');
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
              <span class="velocidade-valor" id="velValor">60%</span>
            </div>
            <input type="range" id="slider" min="0" max="100" value="60"
              oninput="atualizarSlider(this.value)" />
          </div>

          <p class="dica">O painel recebe atualizacoes em tempo real. Se outro cliente enviar um comando, o estado exibido aqui muda automaticamente.</p>

          <section class="status" style="margin-top:12px;">
            <article class="bloco" style="width:100%;">
              <span class="rotulo">WiFi do ESP32</span>
              <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                <input id="wifiSsid" type="text" placeholder="Nome da rede (SSID)"
                  style="flex:2; min-width:180px; padding:8px; border:1px solid #ccc; border-radius:6px; font-size:14px;" />
                <input id="wifiSenha" type="password" placeholder="Senha da rede"
                  style="flex:2; min-width:180px; padding:8px; border:1px solid #ccc; border-radius:6px; font-size:14px;" />
                <button onclick="enviarWifi()" style="flex:1; min-width:120px; padding:8px 16px;
                  background:#1d73be; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:14px;">
                  Conectar ESP
                </button>
              </div>
              <p id="wifiFeedback" style="margin-top:6px; font-size:13px; color:#555;"></p>
            </article>
          </section>
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

          function percentDePwm(pwm) {
            const valor = Math.max(30, Math.min(255, parseInt(pwm, 10) || 30));
            return Math.round(((valor - 30) / (255 - 30)) * 100);
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
            return vel ? nome + " (" + percentDePwm(vel) + "%)" : nome;
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
            const raw = event.data.toString();
            if (raw.startsWith("{")) {
              try {
                const data = JSON.parse(raw);
                if (data.type === "wifiResult") {
                  const fb = document.getElementById("wifiFeedback");
                  if (data.ok) fb.textContent = "Credenciais enviadas ao ESP32. Aguardando reconexao...";
                  else fb.textContent = "Falha: " + (data.error || "nenhum ESP32 conectado");
                  return;
                }
              } catch (_) {}
            }
            atualizarEstado(raw);
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

          function enviarWifi() {
            const ssid = document.getElementById("wifiSsid").value.trim();
            const senha = document.getElementById("wifiSenha").value;
            const fb = document.getElementById("wifiFeedback");
            if (!ssid) { fb.textContent = "Digite o nome da rede."; return; }
            if (ws.readyState !== WebSocket.OPEN) { fb.textContent = "WebSocket desconectado."; return; }
            ws.send(JSON.stringify({ type: "wifiConnect", ssid, password: senha }));
            fb.textContent = "Enviando...";
          }

          definirConexao("", "Conectando");
        </script>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

function obterIpsLocais() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const lista of Object.values(interfaces)) {
    for (const item of lista || []) {
      if (item.family === 'IPv4' && !item.internal) {
        ips.push(item.address);
      }
    }
  }

  return [...new Set(ips)];
}

server.listen(PORT, HOST, () => {
  console.log("Servidor rodando na porta " + PORT);
  console.log("http://localhost:" + PORT);

  const ipsLocais = obterIpsLocais();
  for (const ip of ipsLocais) {
    console.log("http://" + ip + ":" + PORT);
  }
});