#include <WiFi.h>
#include <WebSocketsClient.h>

const char* senhaPadrao = "12345678";

const unsigned long timeoutEscolhaRedeMs = 30000;
const unsigned long timeoutSenhaMs = 45000;

char ssidSelecionado[33] = {0};
char senhaSelecionada[65] = {0};
bool credenciaisDefinidas = false;

const bool modoLocal = true;

// Local
char wsHostLocal[16] = "192.168.137.1"; // fallback
const uint16_t wsPortLocal = 3000;
const char* wsPathLocal = "/";

// Producao
const char* wsHostProd = "servidoresp32-z0gg.onrender.com";
const uint16_t wsPortProd = 443;
const char* wsPathProd = "/";

WebSocketsClient webSocket;

// L298N pinos (canal A)
const int IN1 = 26;
const int IN2 = 25;
const int ENA = 27; // PWM

// PWM config
const int freq = 2000;
const int resolution = 8; // duty 0-255

// Ajustes de torque
const int PWM_MIN_MOV = 30;
const int PWM_KICK = 150;
const int KICK_MS = 50;

int direcaoAtual = 0; // 0=parado, 1=frente, 2=re

bool servidorLocalRespondendo(const char* host) {
  WiFiClient client;
  if (!client.connect(host, wsPortLocal)) {
    return false;
  }

  client.print("GET /esp-discovery HTTP/1.1\r\n");
  client.print("Host: ");
  client.print(host);
  client.print("\r\nConnection: close\r\n\r\n");

  unsigned long inicio = millis();
  String resposta = "";
  while ((millis() - inicio) < 1000) {
    while (client.available()) {
      resposta += static_cast<char>(client.read());
      if (resposta.indexOf("ESP_SERVER_OK") >= 0) {
        client.stop();
        return true;
      }
    }

    if (!client.connected() && !client.available()) {
      break;
    }
    delay(5);
  }

  client.stop();
  return false;
}

bool descobrirServidorLocal() {
  if (servidorLocalRespondendo(wsHostLocal)) {
    Serial.print("Servidor local confirmado em ");
    Serial.println(wsHostLocal);
    return true;
  }

  IPAddress ip = WiFi.localIP();
  String prefixo = String(ip[0]) + "." + String(ip[1]) + "." + String(ip[2]) + ".";

  Serial.print("Procurando servidor local na sub-rede ");
  Serial.print(prefixo);
  Serial.println("x");

  for (int i = 1; i <= 254; i++) {
    if (i == ip[3]) continue;

    String candidato = prefixo + String(i);
    if (servidorLocalRespondendo(candidato.c_str())) {
      candidato.toCharArray(wsHostLocal, sizeof(wsHostLocal));
      Serial.print("Servidor local descoberto em ");
      Serial.println(wsHostLocal);
      return true;
    }
  }

  Serial.println("Nao foi possivel descobrir servidor local automaticamente.");
  return false;
}

bool lerLinhaSerial(String& saida, unsigned long timeoutMs) {
  saida = "";
  unsigned long inicio = millis();

  while ((millis() - inicio) < timeoutMs) {
    while (Serial.available() > 0) {
      char c = static_cast<char>(Serial.read());
      if (c == '\r') continue;
      if (c == '\n') {
        Serial.println();
        saida.trim();
        return true;
      }

      if (c == '\b' || c == 127) {
        if (saida.length() > 0) {
          saida.remove(saida.length() - 1);
          Serial.print("\b \b");
        }
        continue;
      }

      saida += c;
      Serial.print(c);
    }
    delay(10);
  }

  if (saida.length() > 0) {
    Serial.println();
  }
  saida.trim();
  return saida.length() > 0;
}

bool selecionarRedeWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, false);
  delay(100);

  Serial.println("Escaneando redes WiFi disponiveis...");
  int total = WiFi.scanNetworks(false, true);

  if (total <= 0) {
    Serial.println("Nenhuma rede encontrada.");
    WiFi.scanDelete();
    return false;
  }

  Serial.println("Redes encontradas:");
  for (int i = 0; i < total; i++) {
    String status = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "aberta" : "protegida";
    Serial.printf("[%d] %s (RSSI %d dBm, %s)\n", i, WiFi.SSID(i).c_str(), WiFi.RSSI(i), status.c_str());
  }

  Serial.println("Digite o indice da rede e pressione ENTER.");
  Serial.println("Se nao digitar nada, sera usada a rede [0].");

  String escolha;
  bool recebeuEscolha = lerLinhaSerial(escolha, timeoutEscolhaRedeMs);

  int indice = 0;
  if (recebeuEscolha && escolha.length() > 0) {
    indice = escolha.toInt();
  }

  if (indice < 0 || indice >= total) {
    Serial.println("Indice invalido. Usando a rede [0].");
    indice = 0;
  }

  String ssid = WiFi.SSID(indice);
  bool redeAberta = (WiFi.encryptionType(indice) == WIFI_AUTH_OPEN);

  String senha = "";
  if (!redeAberta) {
    Serial.print("Senha para ");
    Serial.print(ssid);
    Serial.println(" (ENTER = senha padrao):");

    String entradaSenha;
    bool recebeuSenha = lerLinhaSerial(entradaSenha, timeoutSenhaMs);
    if (recebeuSenha && entradaSenha.length() > 0) {
      senha = entradaSenha;
    } else {
      senha = senhaPadrao;
    }
  }

  ssid.toCharArray(ssidSelecionado, sizeof(ssidSelecionado));
  senha.toCharArray(senhaSelecionada, sizeof(senhaSelecionada));
  credenciaisDefinidas = true;

  Serial.print("Rede selecionada: ");
  Serial.println(ssidSelecionado);
  Serial.println("Credenciais salvas para reconexao automatica.");

  WiFi.scanDelete();
  return true;
}

int normalizarVel(int vel) {
  vel = constrain(vel, 0, 255);
  if (vel == 0) return 0;
  if (vel < PWM_MIN_MOV) return PWM_MIN_MOV;
  return vel;
}

void aplicarDirecao(int dir) {
  if (dir == 1) {
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
  } else if (dir == 2) {
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);
  } else {
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, LOW);
  }
}

void motorParar() {
  aplicarDirecao(0);
  ledcWrite(ENA, 0);
  direcaoAtual = 0;
}

void moverMotor(int dir, int vel) {
  vel = normalizarVel(vel);

  if (vel == 0 || dir == 0) {
    motorParar();
    return;
  }

  aplicarDirecao(dir);

  if (vel < PWM_KICK) {
    ledcWrite(ENA, PWM_KICK);
    delay(KICK_MS);
  }

  ledcWrite(ENA, vel);
  direcaoAtual = dir;
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  if (!credenciaisDefinidas) {
    if (!selecionarRedeWiFi()) {
      Serial.println("Falha ao selecionar rede. Reiniciando...");
      delay(1000);
      ESP.restart();
    }
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  if (senhaSelecionada[0] == '\0') {
    WiFi.begin(ssidSelecionado);
  } else {
    WiFi.begin(ssidSelecionado, senhaSelecionada);
  }

  Serial.print("Conectando ao WiFi ");
  Serial.println(ssidSelecionado);
  unsigned long inicio = millis();

  while (WiFi.status() != WL_CONNECTED && (millis() - inicio) < 20000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi conectado");
    Serial.print("IP local: ");
    Serial.println(WiFi.localIP());

    if (modoLocal) {
      descobrirServidorLocal();
    }
  } else {
    Serial.println("\nFalha no WiFi. Reiniciando...");
    delay(1000);
    ESP.restart();
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("WebSocket conectado");
      break;

    case WStype_DISCONNECTED:
      Serial.println("WebSocket desconectado");
      motorParar();
      break;

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.println("Recebido: " + msg);

      if (msg == "0") {
        motorParar();
      } else {
        int separador = msg.indexOf(':');
        if (separador > 0) {
          String dir = msg.substring(0, separador);
          int vel = msg.substring(separador + 1).toInt();
          vel = normalizarVel(vel);

          if (dir == "1") {
            moverMotor(1, vel);
          } else if (dir == "2") {
            moverMotor(2, vel);
          } else {
            motorParar();
          }
        } else {
          motorParar();
        }
      }
      break;
    }

    default:
      break;
  }
}

void conectarWebSocket() {
  if (modoLocal) {
    Serial.println("Modo LOCAL");
    Serial.print("Conectando em ws://");
    Serial.print(wsHostLocal);
    Serial.print(":");
    Serial.println(wsPortLocal);
    webSocket.begin(wsHostLocal, wsPortLocal, wsPathLocal);
  } else {
    Serial.println("Modo PRODUCAO");
    Serial.print("Conectando em wss://");
    Serial.print(wsHostProd);
    Serial.print(":");
    Serial.println(wsPortProd);
    webSocket.beginSSL(wsHostProd, wsPortProd, wsPathProd);
  }

  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

void setup() {
  Serial.begin(115200);
  unsigned long inicioSerial = millis();
  while (!Serial && (millis() - inicioSerial) < 5000) {
    delay(10);
  }

  Serial.println();
  Serial.println("Monitor serial pronto.");
  Serial.println("Configure o fim de linha como 'Nova linha' ou 'Ambos NL e CR'.");

  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);

  if (!ledcAttach(ENA, freq, resolution)) {
    Serial.println("ERRO: falha ao configurar PWM no ENA");
  } else {
    Serial.println("PWM configurado no ENA");
  }

  motorParar();

  conectarWiFi();
  conectarWebSocket();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
  }

  webSocket.loop();
}