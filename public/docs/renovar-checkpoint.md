# Renovar o checkpoint Bloch Genesis-4

Use o executável verificado da release, `mainnet.manifest` e o `signer-set.bin` existente (ID 1). Não gere outro conjunto para esta renovação. Execute a preparação em um diretório novo para não sobrescrever a cerimônia anterior.

## 1. Escolher uma época finalizada e extrair

Consulte `getchaininfo` nos dois RPCs e escolha uma época recente já finalizada em ambos (`result.finalized.epoch`), preferencialmente no intervalo de publicação de 256 épocas. Não use a época corrente sem confirmar finalização. Os dois RPCs abaixo são referências públicas da mesma operação; cada signatário deve conferir também a sua própria referência de confiança.

```sh
for rpc in 139.180.166.5:8080 139.180.173.231:8080; do
  curl --fail --show-error --max-time 20 \
    -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"getchaininfo","params":[]}' \
    "http://$rpc/" || exit 1
  printf '\n'
done
```

Substitua `EPOCA_FINALIZADA` pelo número escolhido. O comando recusa divergências entre as referências e épocas ainda não finalizadas.

```sh
./bloch-pos ws-checkpoint \
  --genesis mainnet.manifest \
  --rpc 139.180.166.5:8080,139.180.173.231:8080 \
  --epoch EPOCA_FINALIZADA \
  --signer-set-id 1 \
  --out checkpoint

./bloch-pos ws-verify --checkpoint checkpoint.bin
```

Saem `checkpoint.bin` e `checkpoint.json`. Anote o digest WS. Distribua esses mesmos bytes aos três signatários. Não gere novamente o checkpoint entre assinaturas: `issued_at` participa do digest.

Para reproduzir independentemente a extração, cada signatário usa sua RPC, a mesma época, `--signer-set-id 1` e **`--issued-at` exatamente igual ao checkpoint.json recebido**. Compare os bytes/digest e os campos de rede, bloco e estado antes de assinar. Um `ws-verify --checkpoint` isolado decodifica o arquivo; não consulta a cadeia.

## 2. Cada pessoa assina offline

Na máquina offline de cada signatário, confira o digest contra outro canal de confiança e execute com sua própria chave. `signer.sk` abaixo é um caminho ilustrativo: use o arquivo privado correto da cerimônia. A chave e a senha nunca saem dessa máquina.

Mapeamento confirmado pelas chaves públicas fornecidas: primeiro diretório = índice 0; segundo = índice 1; terceiro = índice 2. São índices do conjunto de signatários, não dos validadores da rede.

```sh
# Pessoa A: índice 0, usando sua própria chave
./bloch-pos ws-verify --checkpoint checkpoint.bin
./bloch-pos ws-sign --key signer.sk --pubkey signer.pk \
  --checkpoint checkpoint.bin --signer-index 0 --out signerA.partial

# Pessoa B: índice 1, em sua própria máquina
./bloch-pos ws-sign --key signer.sk --pubkey signer.pk \
  --checkpoint checkpoint.bin --signer-index 1 --out signerB.partial

# Pessoa C: índice 2, em sua própria máquina
./bloch-pos ws-sign --key signer.sk --pubkey signer.pk \
  --checkpoint checkpoint.bin --signer-index 2 --out signerC.partial
```

Cada pessoa devolve somente seu arquivo `.partial`. Todas devem conferir o checkpoint antes de assinar, como mostrado para A. Não reutilize as assinaturas da época 1536: elas não assinam o checkpoint novo.

## 3. Montar e verificar o envelope

No coordenador, com os três arquivos públicos recebidos:

```sh
./bloch-pos ws-envelope \
  --checkpoint checkpoint.bin --signer-set signer-set.bin \
  --sig 0:signerA.partial --sig 1:signerB.partial --sig 2:signerC.partial \
  --genesis mainnet.manifest --out ws-envelope.bin

./bloch-pos ws-verify \
  --envelope ws-envelope.bin --signer-set signer-set.bin \
  --genesis mainnet.manifest --rpc 139.180.166.5:8080

./bloch-pos ws-verify \
  --envelope ws-envelope.bin --signer-set signer-set.bin \
  --genesis mainnet.manifest --rpc 139.180.173.231:8080
```

Exija as três assinaturas `VALID`, o veredito `ACCEPTED` e a idade `FRESH`. O verificador de envelope consulta a época da RPC para calcular a idade; a comparação dos blocos foi feita na extração. Não confunda validade criptográfica com ausência de expiração.

## 4. Publicar os arquivos públicos

Publique em uma pasta nova por época: `ws-envelope.bin`, `signer-set.bin`, `checkpoint.bin`, `checkpoint.json` e hashes. No macOS:

```sh
shasum -a 256 ws-envelope.bin signer-set.bin checkpoint.bin checkpoint.json > SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt
```

No Linux, use `sha256sum` e `sha256sum --check`. Publique também o digest WS e o fingerprint do conjunto em outro canal independente de confiança. Atualize o manual e a data limite: a sincronização inicial recusa o checkpoint quando `época_atual - época_do_checkpoint >= 2016`. Nunca publique `signer.sk`, chaves de validadores ou uma cópia integral dos diretórios da cerimônia.

O checkpoint atualmente publicado (época 1536) precisa ser substituído antes da época 3552: 22/09/2026 às 05h43min19s de Brasília. A renovação exige novas assinaturas humanas; estes comandos não as automatizam nem publicam por conta própria.
