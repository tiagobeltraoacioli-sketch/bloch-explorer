# Como operar um validador Bloch

Revisado em 14 de setembro de 2026.

## 1. O que este manual permite fazer

Manual operacional para Bloch Genesis-4, revisado em 14/09/2026. Um observador verifica a cadeia sem assinar. Um validador precisa, além disso, de uma chave própria registrada e elegível na cadeia. Instalar o executável não cria uma vaga nem um depósito.

A verificação da frota às 18h01 de Brasília confirmou 64 processos no mesmo binário, todos a 0–1 slot do relógio da rede e com atestações registradas. Naquele instante, 44 haviam concluído a qualificação e 20 ainda estavam em observação. Esse registro é histórico, não um indicador de disponibilidade em tempo real.

O binário agenda a recuperação na época 2880 (14/09/2026, 18h31min19s de Brasília) e o ciclo de admissão/saída na época 2884 (19h35min19s). Consulte o estado atual do seu nó: um horário agendado não prova que a ativação ocorreu. A abertura ampla a novos participantes ainda depende da qualificação operacional do ciclo completo de saída, saque e gasto do valor recebido. Este manual não anuncia essa abertura.

## 2. Prepare o servidor e os arquivos

Use Linux x86_64 para o artefato identificado abaixo, armazenamento SSD persistente, relógio sincronizado e acesso administrativo. A frota de referência utiliza sete servidores de 32 GB para 64 processos; isso não constitui requisito mínimo nem garantia para outra máquina. Dimensione CPU, RAM e disco pela releitura do histórico completo e acompanhe a memória durante a sincronização.

Obtenha pelo canal de distribuição verificado o executável desta release, mainnet.manifest e carryover.tsv. Este guia publica a identificação do artefato, e oferece o checkpoint na seção 3; o executável e o carryover devem ser obtidos pelo canal de release. Não substitua a release por uma compilação arbitrária de main ou por um tag antigo.

```text
Commit: 58da5ce209acb6e293b3b381dfd826dedb8741fd
Linux x86_64 · rustc 1.94.1
SHA-256 bloch-pos:
b3171d1227333284d65c7f60ac925d9e49123908d4c5fcb124ede3f1568a1084
SHA-256 mainnet.manifest:
7eef82a70ef9b0e1dd86f86d33cba11fc10cdfc7395c2e5f6669613fa1beb2dd
SHA-256 carryover.tsv:
84ddbbac2afdd5c78618096a7d4f66cf5b04a3e5757a03fe90550e50096183f6
```

Execute os comandos Linux a seguir no diretório que contém os três arquivos recebidos. Compare os hashes completos. O hash identifica bytes; por si só, ele não é uma auditoria do software.

```text
sha256sum bloch-pos mainnet.manifest carryover.tsv
chmod 755 bloch-pos
./bloch-pos --version
./bloch-pos selfcheck
timedatectl status
free -h
df -h
```

## 3. Escolha a origem do histórico

Máquina nova: a janela inicial de confiança no genesis já terminou. Publicamos o envelope original da época 1536 e seu conjunto de signatários em /checkpoints/epoch-1536/. Em 14/09/2026, o binário desta release verificou as três assinaturas híbridas válidas de três chaves distintas. O conjunto exige 2 de 3 e pelo menos um signatário externo; os três estão declarados externos. Essa declaração não comprova, por si só, identidade ou independência pessoal.

Os dois RPCs públicos concordaram com o bloco d5b3a12207af3010a611b737be15877db476ce9629520e08c552b8995bf23d32 e o estado 84cceba212f6443cc5d9fd67ce578a3ae0f34cba5e5877d8082748b282db0780 do checkpoint. As assinaturas e os bytes originais foram preservados. A verificação não substitui um ensaio completo de sincronização de máquina vazia. O campo validator_set_root é o placeholder zero emitido e aceito por esta release.

Prazo: na época 2878, o checkpoint tinha idade de 1342 épocas dentro da janela de 2016. Ele é aceito, mas já recebe aviso STALE e precisa de renovação. A partir da época 3552, em 22/09/2026 às 05h43min19s de Brasília (08h43min19s UTC), deixa de autorizar sincronização inicial. Confira a época atual; ACCEPTED no verificador criptográfico não elimina um aviso EXPIRED de idade.

Baixe os arquivos abaixo e confira o digest WS e os fingerprints do conjunto por outro canal independente de confiança. Hashes baixados do mesmo site apenas detectam alteração dos bytes; não estabelecem a confiança nos signatários. verification.json registra o resultado, os fingerprints e os limites da checagem.

```text
WS digest original assinado:
e329e6c61ccf91e9338d94a1c1c98e4984e92ad770e995b4ce44596edae2b801
```

```text
mkdir -p checkpoint-1536
cd checkpoint-1536
for file in ws-envelope.bin signer-set.bin checkpoint.bin checkpoint.json verification.json SHA256SUMS.txt; do
  curl --fail --show-error --location --output "$file" "https://blochl1.com/checkpoints/epoch-1536/$file" || exit 1
done
sha256sum --check SHA256SUMS.txt
cd ..
./bloch-pos ws-verify --envelope checkpoint-1536/ws-envelope.bin --signer-set checkpoint-1536/signer-set.bin --genesis mainnet.manifest --rpc 139.180.166.5:8080
```

Apenas copiar um hash de bloco, um ws_latest.bin ou um snapshot de terceiros não equivale a obter um checkpoint assinado. Não crie seu próprio conjunto de signatários para contornar a verificação. O nó ainda reprocessa o histórico completo desde o genesis: o envelope fornece uma âncora de confiança, não um snapshot que elimina o replay.

Operador existente: preserve seu diretório de dados, histórico, metadados, chave e slashing_protection.bin. Use o histórico canônico já validado pelo próprio nó. Não substitua uma âncora local mais recente pela época 1536 nem apague o registro de assinaturas para fazer uma reinicialização passar.

## 4. Prepare a identidade do validador

Para produção, gere e faça backup da identidade e do material RANDAO em uma cerimônia humana offline, usando ferramentas verificadas. O comando keygen do nó é documentado como ferramenta de devnet; não o trate como uma cerimônia de produção. Nunca envie chave privada, semente ou senha a um site, chat, suporte ou RPC.

Uma identidade nova utiliza o índice automático (sentinela 4294967295, normalmente representada por --index auto na preparação da chave). O índice definitivo vem do registro na cadeia. Não escolha um índice livre por conta própria e não altere bytes de uma chave selada para trocar seu índice. Uma identidade existente deve conservar seu índice e sua chave.

A chave de validação deve estar no formato selado BPOSKEY2. O arquivo de senha deve ter permissão 0600 e o diretório que o contém 0700. Mantenha a autoridade de saque e seu backup separados da chave de validação. Nunca execute duas instâncias com a mesma identidade.

```text
# Nó parado; somente para uma chave legada BPOSKEY1 já existente:
./bloch-pos keys seal --dir /var/lib/bloch/validator \
  --passphrase-file /etc/bloch/validator.pass

# Inspecione a identidade com o nó parado:
./bloch-pos keys inspect --dir /var/lib/bloch/validator
```

keys seal converte uma chave legada no lugar; não é necessário nem apropriado executá-lo novamente em uma chave já selada. Não habilite BLOCH_NO_DOPPELGANGER nem BLOCH_KEYSTORE_ALLOW_PLAINTEXT no serviço de produção.

## 5. Instale um serviço Linux

O exemplo usa um único validador por diretório e usuário de serviço bloch. Para um operador existente, adapte os caminhos ao diretório preservado; não o sobrescreva. Para uma instalação nova, prossiga somente após resolver o checkpoint e preparar a identidade. A senha deve ser provisionada pelo operador, sem aparecer em argumentos ou histórico do shell.

```text
sudo useradd --system --home /var/lib/bloch --shell /usr/sbin/nologin bloch
sudo install -d -o bloch -g bloch -m 700 /var/lib/bloch/validator
sudo install -d -o bloch -g bloch -m 700 /etc/bloch
sudo install -m 755 bloch-pos /usr/local/bin/bloch-pos
sudo install -m 644 mainnet.manifest /var/lib/bloch/mainnet.manifest
sudo install -m 644 carryover.tsv /var/lib/bloch/carryover.tsv
```

Não repita useradd se o usuário já existe. Disponibilize validator.key em /var/lib/bloch/validator e a senha em /etc/bloch/validator.pass, ambos pertencentes a bloch e com permissão 0600. Para uma migração de identidade existente, transfira também seu histórico e registro de assinaturas somente depois de parar e desabilitar a instância antiga.

Grave a unidade abaixo em /etc/systemd/system/bloch-validator.service. O transporte devnet é o transporte utilizado por esta frota Genesis-4; o nome não seleciona uma rede de teste. O exemplo permite conexões de saída aos dois bootnodes e mantém RPC, métricas e a porta de escuta P2P locais.

```text
[Unit]
Description=Bloch Genesis-4 validator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bloch
Group=bloch
WorkingDirectory=/var/lib/bloch
Environment=BLOCH_KEYSTORE_PASSPHRASE_FILE=/etc/bloch/validator.pass
UnsetEnvironment=BLOCH_NO_DOPPELGANGER BLOCH_KEYSTORE_ALLOW_PLAINTEXT
ExecStart=/usr/local/bin/bloch-pos run --data-dir /var/lib/bloch/validator --genesis /var/lib/bloch/mainnet.manifest --carryover /var/lib/bloch/carryover.tsv --transport devnet --listen 19000 --listen-addr 127.0.0.1 --peers 139.180.166.5:19100,139.180.173.231:19100 --rpc-bind 127.0.0.1 --rpc-port 16400 --metrics-bind 127.0.0.1 --metrics-port 17400
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
UMask=0077

[Install]
WantedBy=multi-user.target
```

```text
sudo install -m 644 checkpoint-1536/ws-envelope.bin /var/lib/bloch/checkpoint.envelope.bin
sudo install -m 644 checkpoint-1536/signer-set.bin /var/lib/bloch/signer-set.bin
```

Esse ExecStart pressupõe histórico próprio já confiável. Em um nó novo com os arquivos de confiança válidos, acrescente à mesma linha ExecStart: --ws-checkpoint /var/lib/bloch/checkpoint.envelope.bin --ws-signer-set /var/lib/bloch/signer-set.bin. Ambos são arquivos públicos, legíveis pelo usuário bloch. Nunca use uma linha incompleta com reticências no serviço.

```text
sudo systemd-analyze verify /etc/systemd/system/bloch-validator.service
sudo systemctl daemon-reload
sudo systemctl enable --now bloch-validator.service
sudo systemctl status bloch-validator.service
sudo journalctl -u bloch-validator.service -f
```

A RPC não oferece autenticação própria. Mantenha-a em loopback; para acesso remoto, use túnel SSH ou proxy autenticado na sua infraestrutura. Não abra 16400 ou 17400 para a internet. Se precisar receber conexões P2P externas, planeje explicitamente a interface e o firewall; isso é separado da RPC.

## 6. Registre uma identidade nova, quando a admissão estiver liberada

Pule esta seção para uma identidade já registrada. O servidor ligado e sincronizado não é prova de registro. Consulte getvalidatoradmission no seu nó e confirme active: true, o domínio da rede, o mínimo de stake, a taxa e os limites da fila. Confirme também a liberação operacional pública; a ativação do protocolo não substitui a qualificação do ciclo de saque.

```text
curl --fail-with-body -sS http://127.0.0.1:16400/ \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getvalidatoradmission","params":[]}'
```

A admissão financiada consome UTXOs reais de uma autoridade de financiamento, com chave híbrida suite-1. O mínimo definido nesta versão é 25.000 BLCH (2.500.000.000.000 sat), sujeito à conferência na RPC e às regras de inclusão. Um saldo legado não garante que seus outputs tenham o formato necessário. Consulte listunspent e verifique propriedade, valores e scripts.

Prepare o depósito offline e assine separadamente os papéis de financiamento e validação. Os valores entre <...> abaixo são campos a substituir e conferir; não copie a transação como se fosse pronta. A credencial de saque precisa corresponder a uma chave de gasto que você controla.

```text
bloch-pos validator-deposit prepare \
  --genesis mainnet.manifest \
  --funding-pubkey funding.pub.hex --validator-pubkey validator.pub.hex \
  --randao <commitment-hex32> --withdrawal <withdrawal-script-hex32> \
  --change <change-script-hex32> --stake 2500000000000 \
  --input <txid-hex32>:<vout>:<value-sat> \
  --max-base-fee <millisat-per-gas> --tip <millisat-per-gas> \
  --expiry <inclusive-epoch> --commission <basis-points> --out draft.hex

bloch-pos validator-deposit inspect --tx draft.hex
bloch-pos validator-deposit sign --genesis mainnet.manifest \
  --tx draft.hex --role funding --dir funding-keystore --out funded.hex
bloch-pos validator-deposit inspect --tx funded.hex
bloch-pos validator-deposit sign --genesis mainnet.manifest \
  --tx funded.hex --role validator --dir validator-keystore --out ready.hex
bloch-pos validator-deposit inspect --tx ready.hex
```

Cada assinatura usa a senha da sua própria chave por BLOCH_KEYSTORE_PASSPHRASE_FILE, sem argumento de senha. Revise rede, UTXOs, credencial de saque, comissão, taxa e expiração em cada máquina. A CLI não transmite. Só depois da liberação e revisão, envie o conteúdo hexadecimal de ready.hex via sendrawtransaction ao seu próprio nó ou endpoint autenticado. O /rpc deste explorer é somente leitura e não transmite depósitos.

Acompanhe gettxstatus com o ID da transação e getvalidatorbykey com o hash SHA3-256 da chave pública. A ativação exige registro finalizado, pelo menos oito épocas (128 minutos) e respeita o limite de quatro novos validadores por época. A espera pode ser maior; não presuma ativação pelo relógio.

## 7. Confirme sincronização e participação

```text
curl --fail-with-body -sS http://127.0.0.1:16400/ \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getchaininfo","params":[]}'
curl --fail-with-body -sS http://127.0.0.1:17400/metrics
sudo journalctl -u bloch-validator.service --since '30 minutes ago'
```

Espere a releitura terminar e a RPC responder. behind_by_slots em 0–1 indica acompanhamento do topo naquele instante. Confira também avanço da altura e da época finalizada. Compare o mesmo bloco e o mesmo checkpoint entre referências; alturas próximas sozinhas não provam que a cadeia é a mesma.

A janela padrão de observação contra instâncias duplicadas é de 64 slots após a releitura: aproximadamente 32 minutos. Uma identidade registrada e elegível começa suas tarefas após essa janela. Procure attested e proposing block nos logs. Nem todo slot é uma tarefa do seu validador; uma proposta pode demorar a ocorrer.

Na migração da frota, a qualificação exige acompanhamento canônico e avanço de três épocas finalizadas após a primeira atestação. O serviço de exemplo não instala automaticamente o monitor privado da frota: implemente alertas próprios e confirme a inclusão das tarefas na cadeia. Um log de assinatura não prova, sozinho, sua inclusão.

Acompanhe memória, espaço livre, peers, atraso, finalização, reinicializações e mensagens de proteção. Consulte também /validators e /validators/queues neste explorer. Falha no proxy do site não prova parada da cadeia; confira sua RPC local.

## 8. Atualize ou migre sem duplicar a identidade

Antes de trocar a release, confirme os hashes, a rede, as épocas de ativação e a compatibilidade com seu histórico. Pare o serviço e confirme que o processo terminou antes de mover dados ou inspecionar a chave. Faça backup consistente do diretório parado, incluindo validator.key, slashing_protection.bin, blocks.log, meta.bin e ws_latest.bin, além da senha guardada separadamente.

```text
sudo systemctl stop bloch-validator.service
sudo systemctl show bloch-validator.service -p MainPID -p ActiveState
# MainPID deve ser 0 antes da troca ou transferência.
# Verifique a nova release e faça o backup consistente antes de instalar.
sudo install -m 755 /caminho/da/release-verificada/bloch-pos /usr/local/bin/bloch-pos
sudo systemctl start bloch-validator.service
sudo journalctl -u bloch-validator.service -f
```

Em mudança de servidor, desabilite a instância antiga e mantenha-a impedida de iniciar antes de ativar a nova. Preserve a chave, a semente RANDAO e o registro de assinaturas mais recente como um conjunto. Um backup antigo do journal pode permitir assinaturas conflitantes: não o restaure como atalho. Não rode duas cópias nem por alguns segundos.

Se o nó ficar em outro ramo, parar por proteção ou perder o journal, mantenha a assinatura parada e investigue. Não apague metadados, reduza a janela de observação ou use um binário antigo para forçar retomada. Uma reversão de versão após uma mudança de consenso exige análise específica.

## 9. Saída e saque

Depois da ativação do ciclo de vida, uma saída é autenticada pela chave do validador. Consulte a época atual e o registro antes de assinar. A época de inclusão da saída deve coincidir com a época assinada; uma transação expirada precisa ser refeita. As ferramentas a seguir geram arquivos offline e não transmitem.

```text
bloch-pos validator-lifecycle exit --dir validator-keystore \
  --epoch <inclusion-epoch> --out exit.hex

bloch-pos validator-lifecycle withdraw --validator <assigned-index> \
  --out withdraw.hex
```

A saída não libera os fundos imediatamente. Nesta versão, o atraso de saída é de 32 épocas e o atraso de saque é de 2.048 épocas; consulte a elegibilidade no registro. O saque paga a credencial registrada, não um endereço escolhido na hora. Penalidades e a origem financiada ou não do principal alteram o valor resgatável. Preserve a autoridade de gasto da credencial para utilizar o output recebido.

## 10. Diagnóstico rápido e referências

RPC recusada durante replay: acompanhe journalctl e aguarde a inicialização. Chave recusada: verifique formato selado, proprietário e permissões do arquivo de senha. Identidade não elegível: consulte getvalidatorbykey e a fila. Atraso persistente: confira relógio, peers, CPU, disco e o checkpoint. Alerta de duplicidade: pare a assinatura e encontre a outra instância antes de reiniciar.

Este manual é de operação e preparação. Um novo participante ainda precisa dos artefatos de confiança e da admissão efetivamente liberada. Os documentos técnicos anexos são referências da versão revisada, e não garantem entrada imediata. O checkpoint publicado precisa ser renovado antes do prazo indicado na seção 3.


## Renovação do checkpoint

[Comandos para extrair, assinar e publicar o próximo checkpoint](/docs/renovar-checkpoint.md).
