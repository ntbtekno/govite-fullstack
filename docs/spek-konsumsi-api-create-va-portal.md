# Spek Konsumsi API Create VA untuk Portal Mitra

Spesifikasi untuk aplikasi portal internal yang akan membuat Virtual Account (VA) dengan mengkonsumsi service Create VA yang sudah ada di gateway snap-va. Dokumen ini menjawab apakah service tersebut bisa dipakai dari portal, apa yang harus didaftarkan lebih dulu, bagaimana membentuk header dan signature di sisi client, bagaimana request dan response Create VA tunggal, dan bagaimana menjalankan pembuatan VA secara bulk.

Semua nilai kredensial dalam dokumen ini adalah placeholder atau data uji sandbox. Nilai asli tidak ditulis di dokumen mana pun.

## 1. Bisa dipakai — portal menjadi client gateway, bukan client CBS

Bisa. Service Create VA di snap-va memang dibangun sebagai gateway di sisi penyedia (bank) yang dikonsumsi aplikasi mitra lewat API SNAP. Portal Anda menempati posisi yang sama seperti partner host-to-host (H2H) lain:

```text
Portal mitra ──HTTPS + token + signature──> snap-va gateway ──> Core Banking (CBS)
                                              │
                                              └─ database VA lokal gateway
```

Konsekuensinya:

- Portal **tidak** memanggil CBS langsung, tidak membutuhkan kredensial CBS, dan tidak menghitung checksum CBS. Semua itu urusan internal gateway.
- Portal hanya membutuhkan kredensial partner miliknya sendiri (Bagian 2), lalu mengikuti kontrak SNAP di Bagian 3–5.
- Create VA tunggal adalah jalur yang sudah terverifikasi: teruji terhadap CBS SIT dan dipakai dalam panduan pengujian end-to-end gateway, termasuk tipe Full (`F`) dan Partial (`P`), pembayaran, dan pembuatan ulang VA yang sudah dibayar.
- Untuk bulk, model yang dianjurkan saat ini adalah **bulk di sisi portal** — portal mengantrekan banyak item lalu memanggil Create VA tunggal berulang kali. Alasannya dan batasannya ada di Bagian 6. Jangan membangun portal dengan asumsi endpoint bulk gateway sudah siap sebelum verifikasi kecil di sandbox selesai.

Syarat mutlaknya satu: portal harus terdaftar sebagai partner di gateway. Tanpa pendaftaran itu, tidak ada kredensial untuk membentuk header, dan semua request akan ditolak.

## 2. Pendaftaran portal sebagai partner

Pendaftaran dilakukan oleh admin gateway, bukan oleh portal sendiri.

1. Admin membuat partner lewat Admin API gateway, `POST /admin/v1/partners` (autentikasi HTTP Basic admin dari environment, di Swagger UI tersedia di grup Admin). Respons pendaftaran mengembalikan `partnerId`, `clientId`, dan HMAC secret **satu kali** — simpan secret itu saat itu juga di secret storage portal, karena tidak ditampilkan lagi pada pemanggilan berikutnya.
2. Portal membuat pasangan kunci RSA-2048 sendiri (public key dan private key). Private key tetap di portal dan tidak pernah dikirim ke siapa pun. Public key diserahkan ke admin untuk didaftarkan pada aplikasi partner (tersimpan pada record aplikasi partner di gateway).
3. Sepakati dan catat nilai `partnerServiceId` untuk portal, `CHANNEL-ID` yang akan dipakai, dan — bila gateway memberlakukan whitelist — alamat IP egress portal.

### 2.1 Empat identitas yang tidak boleh tertukar

| Identitas | Contoh data uji | Sumber | Dipakai sebagai |
|---|---|---|---|
| `partnerId` | `578` | Di-generate sistem saat pendaftaran | Header `X-PARTNER-ID` pada semua request bisnis |
| `clientId` | `010` | Di-generate sistem saat pendaftaran aplikasi | Header `X-CLIENT-KEY` pada request token saja |
| HMAC secret (`clientSecret`) | *(rahasia, satu kali tampil)* | Respons pendaftaran partner | Kunci HMAC-SHA512 untuk `X-SIGNATURE` request bisnis |
| `partnerServiceId` | `"     010"` | Kode layanan partner, 8 karakter left-pad spasi | Field body `partnerServiceId` pada setiap request |

Kesalahan yang sudah terbukti terjadi: mengisi `X-PARTNER-ID` dengan `clientId`. Token diterbitkan untuk satu partner, header menyebut partner lain, dan gateway menjawab `4012700` "Token partner mismatch". `X-PARTNER-ID` selalu `partnerId`, bukan `clientId` dan bukan `partnerServiceId`.

### 2.2 Penyimpanan rahasia di portal

- Simpan HMAC secret dan RSA private key di secret manager atau environment variable server portal. Jangan commit ke Git, jangan simpan di database aplikasi dalam teks biasa, dan jangan tampilkan di log.
- Log portal boleh mencatat `responseCode`, `trxId`, nomor VA, dan waktu. Log tidak boleh mencatat access token, HMAC secret, private key, atau `X-SIGNATURE` lengkap.
- Bila secret bocor atau perlu diganti, admin melakukan rotasi lewat Admin API; portal mengganti nilai tersimpan lalu menguji satu request token dan satu Create VA di sandbox.

## 3. Urutan pemanggilan

Setiap sesi kerja portal mengikuti urutan yang sama:

1. Ambil access token (Bagian 4.1), kecuali portal masih memegang token yang belum kedaluwarsa.
2. Bentuk body Create VA sebagai satu string JSON final (Bagian 5.1).
3. Bentuk header bisnis dari body final itu (Bagian 4.2). Signature dihitung dari body yang persis akan dikirim — bukan dari objek yang nantinya di-serialisasi ulang oleh HTTP client.
4. Kirim `POST /api/v1.0/transfer-va/create-va`.
5. Baca `responseCode` terlebih dahulu, baru `virtualAccountData`. Simpan nomor VA dari response (Bagian 5.2) sebagai nomor resmi.
6. Untuk kebutuhan berikutnya — inquiry, pembayaran, status — pakai nomor VA lengkap dari response Create VA, bukan nilai `virtualAccountNo` yang dikirim pada request Create VA.

Base URL mengikuti environment gateway yang dituju, misalnya `http://localhost:8080` untuk pengembangan lokal dan URL sandbox atau production yang diberikan admin gateway. Jangan hardcode satu URL untuk semua environment; jadikan base URL konfigurasi portal.

## 4. Pembentukan header di sisi client

Ada dua kelompok header yang rumusnya berbeda: header token memakai signature RSA, header bisnis memakai signature HMAC. Mencampur keduanya adalah kesalahan paling umum.

### 4.1 Header untuk mengambil token

Endpoint: `POST /api/v1.0/access-token/b2b`, service token (73).

| Header | Isi |
|---|---|
| `Content-Type` | `application/json` |
| `X-TIMESTAMP` | Waktu sekarang, format di Bagian 4.3 |
| `X-CLIENT-KEY` | `clientId` portal |
| `X-SIGNATURE` | Signature RSA, rumus di bawah |
| `Origin` | Domain portal, tercantum sebagai header pada kontrak endpoint token |

Pada endpoint ini **tidak** dikirim: `Authorization`, `X-PARTNER-ID`, `X-EXTERNAL-ID`, dan `CHANNEL-ID`.

Rumus signature token:

```text
stringToSign = X-CLIENT-KEY + "|" + X-TIMESTAMP
X-SIGNATURE  = Base64( SHA256withRSA(stringToSign, rsaPrivateKey) )
```

Artinya: gabungkan `clientId`, karakter `|`, dan timestamp menjadi satu string, tanda tangani dengan RSA private key portal memakai skema SHA256withRSA (RSASSA-PKCS1-v1_5 dengan SHA-256), lalu encode hasilnya ke Base64.

Body token:

```json
{ "grantType": "client_credentials" }
```

Response sukses:

```json
{
  "responseCode": "2007300",
  "responseMessage": "Successful",
  "accessToken": "<access-token>",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

Aturan pemakaian token:

- Masa berlaku token 900 detik (15 menit). Simpan token di cache portal beserta waktu kedaluwarsanya, dan pakai ulang untuk banyak request — termasuk untuk seluruh item dalam satu batch bulk.
- Ambil token baru sebelum token lama kedaluwarsa, misalnya saat sisa umur di bawah 60 detik, atau segera setelah menerima penolakan token. Jangan mengambil token baru untuk setiap Create VA: endpoint token mempunyai batas laju tersendiri yang jauh lebih ketat daripada endpoint bisnis (Bagian 6.3).
- Penolakan token yang umum: `4017300` untuk signature RSA yang tidak sah. Periksa urutan `clientId|timestamp`, kesesuaian private key dengan public key yang terdaftar, dan jam server portal.

### 4.2 Header untuk request bisnis (Create VA)

| Header | Isi |
|---|---|
| `Authorization` | `Bearer <accessToken>` |
| `Content-Type` | `application/json` |
| `X-TIMESTAMP` | Waktu pengiriman request ini, format di Bagian 4.3 |
| `X-SIGNATURE` | Signature HMAC-SHA512, rumus di bawah |
| `X-PARTNER-ID` | `partnerId` portal — bukan `clientId` |
| `X-EXTERNAL-ID` | ID unik request ini, aturan di bawah |
| `CHANNEL-ID` | 5 digit numerik, contoh `02030` |
| `Origin` | Domain portal, tercantum sebagai header pada kontrak endpoint bisnis |

Rumus signature bisnis, dikerjakan berurutan:

```text
1. minifiedBody = minify(bodyJsonFinal)
2. bodyHash     = Lowercase( HexEncode( SHA-256(minifiedBody) ) )
3. stringToSign = "POST" + ":" + "/api/v1.0/transfer-va/create-va" + ":"
                + accessToken + ":" + bodyHash + ":" + X-TIMESTAMP
4. X-SIGNATURE  = Base64( HMAC-SHA512(stringToSign, clientSecret) )
```

Aturan tiap langkah:

- `minify` berarti menghapus whitespace JSON yang tidak signifikan **di luar string saja** — spasi, tab, dan baris baru antar token. Urutan key dipertahankan persis, whitespace di dalam nilai string tidak diubah, dan tidak ada pengurutan key, re-serialisasi, atau normalisasi angka. Cara paling aman: serialisasi body satu kali menjadi string, hitung hash dari string itu, lalu kirim string yang sama sebagai body mentah.
- Hash body ditulis sebagai hex **huruf kecil**. Signature akhir ditulis sebagai **Base64**, bukan hex.
- Method ditulis huruf besar (`POST`) dan URL pada `stringToSign` adalah path saja tanpa host dan tanpa skema, persis `/api/v1.0/transfer-va/create-va` untuk Create VA. Untuk endpoint lain, ganti method dan path sesuai endpoint yang dipanggil; rumus lainnya sama.
- Timestamp pada header, pada `stringToSign`, dan yang benar-benar dikirim harus nilai yang sama. Buat timestamp baru untuk setiap request, sedekat mungkin dengan waktu pengiriman.
- `X-EXTERNAL-ID`: maksimal 16 karakter alfanumerik, unik per request per hari. Nilai ini adalah kunci idempotency di gateway: request yang dikirim ulang dengan `X-EXTERNAL-ID` yang sama akan menerima response tersimpan dari request pertama, tanpa pemrosesan baru. Karena itu setiap Create VA yang berbeda wajib memakai `X-EXTERNAL-ID` baru, dan satu nilai tidak boleh dipakai untuk dua VA berbeda.
- `Origin` tidak masuk ke dalam `stringToSign`. Contoh kode di Bagian 8 tidak mengirimnya, mengikuti panduan pengujian sandbox; bila kontrak environment gateway Anda mewajibkannya, tambahkan header `Origin: <domain-portal>` pada request token maupun bisnis tanpa mengubah rumus signature.

### 4.3 Format timestamp

```text
Format   : YYYY-MM-DDTHH:mm:ss+08:00   (ISO 8601, tanpa milidetik)
Zona     : WITA (GMT+8), offset ditulis +08:00
Toleransi: ±120 detik dari waktu server gateway
Contoh   : 2026-11-12T16:20:00+08:00
```

Sinkronkan jam server portal (NTP). Request dengan timestamp di luar jendela toleransi ditolak sebagai tidak sah, berapa pun benarnya signature.

### 4.4 Contoh terapan pembentukan signature bisnis

Contoh ini memakai data uji sandbox dari panduan pengujian gateway: `partnerId` `578`, `clientId` `010`, `partnerServiceId` `"     010"`. Access token dan secret ditulis sebagai placeholder karena nilainya rahasia dan berubah tiap sesi.

Body final yang akan dikirim (satu string, urutan key seperti ini):

```json
{"partnerServiceId":"     010","customerNo":"20261023000001","virtualAccountNo":"     20261023000001","virtualAccountName":"Budi Santoso","trxId":"INV-2026-000001","totalAmount":{"value":"150000.00","currency":"IDR"},"virtualAccountTrxType":"F","expiredDate":"2026-12-31T23:59:59+08:00","additionalInfo":{"description":"Tagihan SPP","phone":"+6281234567890"}}
```

Body di atas sudah dalam bentuk minify, sehingga langkah hash dapat diperiksa langsung:

```text
SHA-256(minifiedBody) = de0a89c2f214065d6798800d05c56a2544ef3c6c62edbeed8f350008df081118
                      (hex huruf kecil, 64 karakter)
```

Dengan timestamp contoh `2026-11-12T16:20:00+08:00`, `stringToSign` menjadi:

```text
POST:/api/v1.0/transfer-va/create-va:<accessToken>:de0a89c2f214065d6798800d05c56a2544ef3c6c62edbeed8f350008df081118:2026-11-12T16:20:00+08:00
```

`X-SIGNATURE` adalah Base64 dari HMAC-SHA512 atas string tersebut dengan kunci HMAC secret portal. Gunakan nilai hash di atas sebagai vektor uji unit di portal: bila fungsi minify dan hash portal menghasilkan nilai yang berbeda untuk body contoh ini, perbaikan ada di sisi portal — biasanya karena objek JSON di-serialisasi ulang dengan urutan key berbeda atau spasi di dalam string ikut diubah.

## 5. Create VA tunggal

### 5.1 Request

Endpoint: `POST /api/v1.0/transfer-va/create-va`, service Create VA (27), dengan header bisnis Bagian 4.2.

| Field | Wajib | Panjang maks | Aturan |
|---|---|---:|---|
| `partnerServiceId` | Ya | 8 | Left-pad spasi, contoh `"     010"` |
| `customerNo` | Ya | 14 | Digit angka, nomor pelanggan murni tanpa prefix |
| `virtualAccountNo` | Ya | 19 pada request | Lihat aturan khusus di bawah tabel |
| `virtualAccountName` | Ya | 30 | Nama pemilik VA |
| `trxId` | Ya | 19 | Unik per partner; kunci duplikat dan kunci retry (Bagian 7) |
| `totalAmount.value` | Ya | 21 | String desimal, 2 angka di belakang koma, contoh `"150000.00"` |
| `totalAmount.currency` | Ya | 3 | `IDR` |
| `virtualAccountTrxType` | Ya | 1 | `F` = Full, `P` = Partial |
| `expiredDate` | Ya pada implementasi gateway saat ini | 25 | ISO 8601 dengan offset, harus di masa depan |
| `additionalInfo.description` | Tidak | 60 | Deskripsi tagihan |
| `additionalInfo.phone` | Tidak | — | Nomor telepon yang tersimpan bersama VA pada contoh gateway |

Aturan khusus `virtualAccountNo` pada Create VA — bagian ini paling sering salah tafsir:

- Pada **request Create VA**, field ini **bukan** nomor VA lengkap. Isi dengan spasi left-pad ditambah `customerNo`, contoh `"     20261023000001"` (5 spasi + 14 digit = 19 karakter). Gateway memangkas spasi, mengambil bagian nomor pelanggan, dan meneruskannya ke CBS. Validasi prefix nomor VA tidak berlaku pada request Create VA.
- Nomor VA resmi lahir di CBS dan datang pada **response**: `virtualAccountData.virtualAccountNo` berisi spasi left-pad ditambah nomor VA lengkap (VANBR) 19 digit, contoh `"     0104120261023000001"` (5 spasi + 19 digit = 24 karakter). Pada contoh itu, 5 digit pertama VANBR adalah prefix `01041` — tiga digit terakhir `partnerServiceId` ditambah literal `41` — diikuti 14 digit `customerNo`.
- Pada semua operasi sesudah Create VA (inquiry, pembayaran, status), kirim nomor lengkap dari response tersebut. Jangan memakai kembali nilai versi request.

Contoh request lengkap ada pada body di Bagian 4.4.

### 5.2 Response sukses

```json
{
  "responseCode": "2002700",
  "responseMessage": "Successful",
  "virtualAccountData": {
    "partnerServiceId": "     010",
    "customerNo": "20261023000001",
    "virtualAccountNo": "     0104120261023000001",
    "virtualAccountName": "Budi Santoso",
    "trxId": "INV-2026-000001",
    "totalAmount": { "value": "150000.00", "currency": "IDR" },
    "virtualAccountTrxType": "F",
    "expiredDate": "2026-12-31T23:59:59+08:00",
    "status": "ACTIVE",
    "referenceNo": "",
    "additionalInfo": { "description": "Tagihan SPP", "phone": "+6281234567890" }
  }
}
```

Yang wajib dilakukan portal setelah response ini:

- Perlakukan `2002700` dengan `status` `ACTIVE` sebagai satu-satunya tanda VA berhasil dibuat dan siap dibayar. Response sukses pada contoh kontrak lama yang masih menulis `PENDING` jangan dijadikan acuan — pada alur aktual, registrasi CBS bersifat sinkron dan VA sukses kembali sebagai `ACTIVE`.
- Simpan `virtualAccountNo` dari response persis apa adanya beserta versi tanpa spasinya. Nilai inilah yang ditampilkan ke pengguna portal dan dipakai pada operasi berikutnya.
- Simpan juga `trxId`, `customerNo`, dan `referenceNo` (boleh berupa string kosong) untuk rekonsiliasi dan pencarian ulang.

### 5.3 Response negatif yang perlu ditangani portal

Format kode: 7 digit = HTTP (3) + service `27` (2) + kasus (2). Portal mengambil keputusan dari `responseCode`, bukan dari teks pesan.

| `responseCode` | Arti | Tindakan portal |
|---|---|---|
| `4002701` | Format field tidak valid | Perbaiki data baris itu; jangan retry otomatis |
| `4002702` | Field wajib hilang, `expiredDate` lewat, atau penolakan bisnis CBS | Perbaiki data atau tandai gagal bisnis; simpan `responseMessage` |
| `4012700` | Token tidak cocok dengan partner | Periksa `X-PARTNER-ID` = `partnerId`; ambil token baru, lalu uji satu request |
| `4012701` | Signature bisnis tidak sah atau token tidak valid | Periksa rumus Bagian 4.2, jam server, dan kesegaran token |
| `4092700` | VA untuk `trxId` yang sama sudah `PAID` | Anggap tagihan itu sudah lunas; jangan buat ulang dan jangan ubah datanya |
| `4092701` | VA dengan `trxId` yang sama masih `ACTIVE` | Anggap VA sudah ada; ambil datanya lewat inquiry, jangan buat duplikat |
| `429` (dengan kode service terkait) | Batas laju terlampaui | Tunggu sesuai header `Retry-After`, turunkan kecepatan pengiriman (Bagian 6.3) |
| `5002700` | Error server atau kegagalan ke CBS | Ikuti aturan retry di Bagian 7; jangan langsung mengganti `trxId` |

Dua perilaku duplikat yang menentukan desain portal:

- `trxId` yang sama pada VA yang sudah `PAID` selalu ditolak `4092700`. Agar VA yang sama bisa dipakai untuk tagihan baru, kirim Create VA dengan `trxId` **baru**: gateway menjalankan recycle — VA kembali `ACTIVE` dengan data tagihan baru, riwayat pembayaran siklus lama tetap tersimpan.
- VA yang masih `ACTIVE` ditolak `4092701` apa pun `trxId`-nya. Satu nomor VA hanya memegang satu tagihan aktif pada satu waktu.

## 6. Bulk request

### 6.1 Penilaian: pakai loop di atas Create VA tunggal

Ada endpoint bulk pada kontrak gateway, `POST /api/v1.0/transfer-va/bulk-create`, tetapi dua deskripsi kontraknya tidak selaras — perlu dibaca sebagai peringatan, bukan sebagai janji:

| Sumber kontrak | Bentuk bulk yang digambarkan |
|---|---|
| `openapi.yaml` gateway | Sinkron: satu request berisi `items` (1–500 item, tiap item sama dengan skema Create VA tunggal), response `2002700` dengan ringkasan `total` / `success` / `failed` dan hasil per item (partial success) |
| Dokumen arsitektur gateway §4.3 | Asinkron: response `202 Accepted` dengan `batchId` dan status awal `QUEUED`, item diproses worker di belakang, partner memeriksa hasil lewat inquiry batch |

Kedua bentuk itu tidak bisa sama-sama benar untuk satu endpoint, dan pengujian end-to-end terakhir yang terdokumentasi pada gateway berfokus pada Create VA tunggal — bukan pada bulk. Kesimpulan praktisnya:

- **Model utama (dianjurkan sekarang): bulk di sisi portal.** Portal menyimpan daftar tagihan sebagai satu pekerjaan bulk, lalu memanggil Create VA tunggal satu per satu (Bagian 6.2). Jalur ini hanya memakai perilaku yang sudah terverifikasi.
- **Endpoint bulk gateway: verifikasi dulu, baru boleh diandalkan.** Sebelum memakainya, kirim satu batch kecil (2–3 item) ke sandbox dan cocokkan fakta di lapangan: kode HTTP yang kembali (`200` atau `202`), bentuk response (ringkasan per item atau `batchId`), dan cara memeriksa hasil akhir. Tuliskan hasil verifikasi itu sebagai lampiran kontrak portal. Bila bentuk aktualnya mengikuti `openapi.yaml`, header untuk batch dibentuk satu kali dengan rumus Bagian 4.2 atas seluruh body batch (method dan path diganti menjadi endpoint bulk), dengan satu `X-EXTERNAL-ID` untuk batch tersebut.

### 6.2 Model bulk di sisi portal

Portal memperlakukan bulk sebagai antrean pekerjaannya sendiri:

1. Pengguna portal mengunggah atau memasukkan banyak tagihan. Portal memvalidasi semua baris secara lokal lebih dulu — field wajib, panjang, format nominal, `expiredDate` di masa depan, dan tidak ada `trxId` ganda di dalam satu batch maupun terhadap tagihan yang sudah pernah dikirim. Baris yang tidak lolos tidak masuk antrean sama sekali.
2. Portal menyimpan batch dan tiap item dengan status awal `QUEUED` di database portal, lengkap dengan `trxId` dan `X-EXTERNAL-ID` yang akan dipakai untuk item itu.
3. Worker portal mengambil item satu per satu, atau dengan paralelisme kecil yang dibatasi (mulai dari sekuensial; naikkan hanya setelah melihat perilaku sandbox). Setiap item adalah satu panggilan Create VA tunggal yang utuh: body sendiri, timestamp sendiri, signature sendiri, `X-EXTERNAL-ID` sendiri. Yang dipakai bersama hanya access token yang masih berlaku.
4. Hasil tiap item dicatat segera setelah responsenya tiba (Bagian 7), lalu worker lanjut ke item berikutnya. Jangan menunggu seluruh batch selesai untuk menyimpan hasil — batch yang terputus di tengah harus bisa dilanjutkan dari item terakhir yang belum berstatus akhir.
5. Di akhir, portal menampilkan ringkasan batch dari catatannya sendiri: total item, berhasil (`ACTIVE`), gagal bisnis, dan gagal yang boleh dicoba lagi, beserta daftar item gagal dan alasannya per baris.

Hasil bulk dengan model ini memang tidak atomik — dan memang tidak perlu: sebagian item berhasil dan sebagian gagal adalah hasil normal (partial success). Item yang berhasil tidak pernah di-roll back karena item lain gagal.

### 6.3 Batas laju dan umur token selama batch

Dua batas gateway menentukan kecepatan dan durasi batch:

| Batas | Nilai konfigurasi gateway | Dampak ke portal |
|---|---|---|
| Request bisnis | 100 request per menit, burst 200 | Jaga laju worker di bawah 100 per menit per partner; patuhi `Retry-After` bila menerima `429` |
| Request token | 10 request per menit | Ambil token sekali untuk satu batch; jangan ambil token per item |
| Endpoint bulk gateway (bila dipakai) | 5 request per menit | Satu alasan tambahan endpoint bulk tidak menggantikan loop begitu saja: batch besar tetap harus dipecah dan dijeda |

Selain batas laju, setiap Create VA menunggu jawaban sinkron dari CBS di dalam gateway, jadi satu item dapat memakan waktu beberapa detik. Umur token hanya 900 detik: pada batch besar yang berjalan sekuensial, token dapat kedaluwarsa di tengah batch. Worker wajib memeriksa sisa umur token sebelum setiap item dan mengambil token baru bila perlu — penolakan token di tengah batch adalah kejadian normal yang ditangani dengan refresh token, bukan dengan mengulang seluruh batch.

Portal tidak menjanjikan waktu selesai batch kepada pengguna berdasarkan hitungan teoritis. Tampilkan progres berdasarkan item yang benar-benar sudah berstatus akhir di catatan portal.

## 7. Hasil per item, retry, dan idempotency

### 7.1 Pencatatan hasil per item

Untuk setiap item, portal menyimpan minimal: `trxId`, `customerNo`, `X-EXTERNAL-ID` yang dipakai, `responseCode` dan `responseMessage` terakhir, `virtualAccountNo` dari response (bila sukses), status item di portal, dan waktu percobaan terakhir. Status item di portal cukup empat: `QUEUED`, `SENDING`, `SUCCESS` (untuk `2002700` `ACTIVE`), dan `FAILED` beserta kelompok alasannya — data tidak valid, duplikat atau konflik, atau kegagalan server yang masih boleh dicoba lagi.

### 7.2 Aturan retry

- **Jangan** mengirim ulang request dengan `X-EXTERNAL-ID` yang sama untuk mengharapkan pemrosesan baru. Pengiriman ulang seperti itu mengembalikan response tersimpan dari percobaan pertama, sehingga portal bisa mengira sebuah pembayaran atau pembuatan berhasil padahal tidak ada tulisan baru di gateway. Setiap percobaan pemrosesan baru memakai `X-EXTERNAL-ID` baru.
- Sebaliknya, `trxId` adalah penentu identitas tagihan. Pada kegagalan server (`5002700`) atau timeout jaringan — keadaan di mana CBS mungkin sudah mendaftarkan VA sebelum koneksi putus — kirim ulang dengan **`trxId` yang sama** dan `X-EXTERNAL-ID` baru. Alur gateway memang dirancang untuk ini: pengecekan duplikat lokal dan penanganan VA yang sudah terdaftar di CBS akan memulihkan keadaan menjadi satu VA, bukan dua.
- **Jangan mengganti `trxId` hanya karena percobaan pertama gagal.** `trxId` baru berarti tagihan baru; memakainya untuk menutupi kegagalan akan meninggalkan VA yatim dari percobaan pertama dan mengacaukan rekonsiliasi. `trxId` baru hanya untuk tagihan baru, termasuk untuk recycle VA yang sudah `PAID` (Bagian 5.3).
- Kegagalan format dan mandatory (`4002701`, `4002702` karena data portal) tidak di-retry otomatis. Perbaiki datanya dulu.
- Konflik `4092700` dan `4092701` adalah status akhir, bukan antrean retry. Tangani sesuai tabel Bagian 5.3.
- Sebelum menyatakan sebuah item gagal total setelah timeout, periksa dulu keberadaan VA-nya lewat inquiry VA gateway dengan nomor pelanggan atau `trxId` item tersebut. Bila VA ternyata sudah `ACTIVE`, catat item sebagai berhasil dengan nomor VA dari inquiry itu.

## 8. Contoh kode client

Contoh berikut memakai Python agar rumus header terbaca tanpa tergantung framework portal. Terjemahkan fungsi-fungsinya apa adanya ke bahasa portal Anda; yang tidak boleh berubah adalah urutan langkah dan string yang ditandatangani.

### 8.1 Fungsi timestamp, minify, dan signature

```python
import base64, hashlib, hmac, json, secrets, string
from datetime import datetime
from zoneinfo import ZoneInfo

WITA = ZoneInfo("Asia/Makassar")

def now_timestamp() -> str:
    # ISO 8601 WITA tanpa milidetik, contoh 2026-11-12T16:20:00+08:00
    return datetime.now(WITA).strftime("%Y-%m-%dT%H:%M:%S+08:00")

def minify(raw: str) -> str:
    # Hapus whitespace di luar string saja; urutan key dipertahankan.
    out, in_string, escaped = [], False, False
    for ch in raw:
        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
            out.append(ch)
        elif ch not in " \t\r\n":
            out.append(ch)
    return "".join(out)

def business_signature(method, path, access_token, body_raw, timestamp, client_secret):
    body_hash = hashlib.sha256(minify(body_raw).encode()).hexdigest()  # hex huruf kecil
    string_to_sign = f"{method}:{path}:{access_token}:{body_hash}:{timestamp}"
    digest = hmac.new(client_secret.encode(), string_to_sign.encode(),
                      hashlib.sha512).digest()
    return base64.b64encode(digest).decode()

def new_external_id() -> str:
    # 16 karakter alfanumerik, baru untuk setiap request
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(16))
```

### 8.2 Mengambil dan meng-cache token

```python
import time
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

class TokenCache:
    def __init__(self, base_url, client_id, private_key_pem):
        self.base_url, self.client_id = base_url, client_id
        self.private_key = serialization.load_pem_private_key(
            private_key_pem.encode(), password=None)
        self.token, self.expires_at = None, 0.0

    def get(self, http) -> str:
        if self.token and time.time() < self.expires_at - 60:
            return self.token
        timestamp = now_timestamp()
        string_to_sign = f"{self.client_id}|{timestamp}"
        signature = base64.b64encode(self.private_key.sign(
            string_to_sign.encode(), padding.PKCS1v15(), hashes.SHA256())).decode()
        resp = http.post(
            f"{self.base_url}/api/v1.0/access-token/b2b",
            headers={"Content-Type": "application/json",
                     "X-TIMESTAMP": timestamp,
                     "X-CLIENT-KEY": self.client_id,
                     "X-SIGNATURE": signature},
            json={"grantType": "client_credentials"})
        data = resp.json()
        assert data["responseCode"] == "2007300", data
        self.token = data["accessToken"]
        self.expires_at = time.time() + int(data["expiresIn"])  # 900 detik
        return self.token
```

### 8.3 Satu panggilan Create VA

```python
CREATE_PATH = "/api/v1.0/transfer-va/create-va"

def create_va(http, base_url, tokens, partner_id, client_secret, channel_id, item):
    # Serialisasi SATU KALI; string yang sama ditandatangani dan dikirim.
    body_raw = json.dumps(item, separators=(",", ":"), ensure_ascii=False)
    access_token = tokens.get(http)
    timestamp = now_timestamp()
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": business_signature(
            "POST", CREATE_PATH, access_token, body_raw, timestamp, client_secret),
        "X-PARTNER-ID": partner_id,        # partnerId, BUKAN clientId
        "X-EXTERNAL-ID": new_external_id(),
        "CHANNEL-ID": channel_id,          # contoh "02030"
    }
    # data=body_raw, bukan json=item, agar byte yang dikirim sama dengan yang ditandatangani
    resp = http.post(f"{base_url}{CREATE_PATH}", headers=headers, data=body_raw.encode())
    return resp.json()

def build_item(partner_service_id, customer_no, name, trx_id, amount, trx_type,
               expired_date, description=None, phone=None):
    additional = {k: v for k, v in
                  (("description", description), ("phone", phone)) if v is not None}
    return {
        "partnerServiceId": partner_service_id.rjust(8),       # left-pad spasi ke 8
        "customerNo": customer_no,
        # Request create: BUKAN nomor VA lengkap — spasi + customerNo (Bagian 5.1)
        "virtualAccountNo": customer_no.rjust(19),
        "virtualAccountName": name,
        "trxId": trx_id,
        "totalAmount": {"value": amount, "currency": "IDR"},
        "virtualAccountTrxType": trx_type,                     # "F" atau "P"
        "expiredDate": expired_date,
        "additionalInfo": additional,
    }
```

### 8.4 Loop bulk di sisi portal

```python
def run_batch(http, base_url, tokens, partner_id, client_secret, channel_id, items, store):
    for item in items:  # items sudah tervalidasi lokal dan tersimpan sebagai QUEUED
        store.mark_sending(item)
        try:
            result = create_va(http, base_url, tokens,
                               partner_id, client_secret, channel_id, item)
        except Exception as exc:  # timeout / error jaringan: hasil belum diketahui
            # Retry mengikuti Bagian 7.2: trxId sama, X-EXTERNAL-ID baru, cek inquiry dulu
            store.mark_failed_retryable(item, reason=str(exc))
            continue
        code = result.get("responseCode")
        if code == "2002700":
            va = result["virtualAccountData"]
            store.mark_success(item, va_number=va["virtualAccountNo"].strip(),
                               status=va.get("status"), reference_no=va.get("referenceNo"))
        elif code in ("4092700", "4092701"):
            store.mark_final_conflict(item, code, result.get("responseMessage"))
        elif code in ("4002701", "4002702"):
            store.mark_final_invalid(item, code, result.get("responseMessage"))
        else:  # 401 karena token, 429, 5002700, dan kode lain
            store.mark_failed_retryable(item, code, result.get("responseMessage"))
    return store.batch_summary()  # total, sukses, gagal final, boleh dicoba lagi
```

Perhatikan bahwa di dalam loop tidak ada pengambilan token per item: `TokenCache.get` mengembalikan token tersimpan selama masih berlaku dan hanya mengambil token baru menjelang kedaluwarsa. Signature, timestamp, dan `X-EXTERNAL-ID` sebaliknya selalu baru per item, karena ketiganya terikat pada body dan waktu request item tersebut.

### 8.5 Bentuk request dengan curl (satu item, setelah header dihitung)

```bash
curl -X POST '{base-url}/api/v1.0/transfer-va/create-va' \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'Content-Type: application/json' \
  -H 'X-TIMESTAMP: 2026-11-12T16:20:00+08:00' \
  -H 'X-SIGNATURE: <Base64-HMAC-SHA512-dari-Bagian-4.2>' \
  -H 'X-PARTNER-ID: <partnerId>' \
  -H 'X-EXTERNAL-ID: <16-karakter-baru>' \
  -H 'CHANNEL-ID: 02030' \
  --data-raw '{"partnerServiceId":"     010","customerNo":"20261023000001","virtualAccountNo":"     20261023000001","virtualAccountName":"Budi Santoso","trxId":"INV-2026-000001","totalAmount":{"value":"150000.00","currency":"IDR"},"virtualAccountTrxType":"F","expiredDate":"2026-12-31T23:59:59+08:00","additionalInfo":{"description":"Tagihan SPP","phone":"+6281234567890"}}'
```

Curl di sini hanya alat pemeriksa bentuk request. Pembentukan signature tetap dilakukan kode portal (Bagian 8.1–8.3), bukan dihitung manual di terminal untuk pemakaian rutin.

## 9. Checklist sebelum portal dipakai

- [ ] Partner portal sudah terdaftar; `partnerId`, `clientId`, dan HMAC secret tersimpan di secret storage portal, dan public key RSA portal sudah terdaftar di gateway.
- [ ] Uji unit minify dan hash portal lolos memakai vektor uji Bagian 4.4.
- [ ] Di sandbox: ambil token, buat satu VA tipe `F` dan satu tipe `P`, dan pastikan response `2002700` dengan status `ACTIVE` dan nomor VA lengkap tersimpan di portal.
- [ ] Uji penolakan yang disengaja: `X-PARTNER-ID` salah, signature dari body yang diubah setelah ditandatangani, dan timestamp yang digeser lebih dari 120 detik — ketiganya harus ditolak, agar portal terbukti membaca penolakan dengan benar.
- [ ] Uji duplikat: `trxId` sama pada VA `ACTIVE` menghasilkan `4092701`, dan pada VA `PAID` menghasilkan `4092700`; recycle dengan `trxId` baru pada VA `PAID` kembali `ACTIVE`.
- [ ] Batch kecil (10–20 item) berjalan lewat loop Bagian 6.2 dengan hasil per item tercatat, satu item gagal tidak menghentikan item lain, dan batch yang dihentikan di tengah dapat dilanjutkan.
- [ ] Verifikasi endpoint bulk gateway (Bagian 6.1) sudah dilakukan dan hasilnya dicatat, **atau** portal secara eksplisit hanya memakai loop Create VA tunggal.
- [ ] Jam server portal tersinkron (NTP), laju worker di bawah batas request bisnis, dan refresh token di tengah batch sudah diuji dengan batch yang berjalan melewati 15 menit.
- [ ] Tidak ada token, secret, private key, atau signature lengkap pada log portal.

## 10. Sumber kontrak

Kontrak pada dokumen ini dirangkum dari spesifikasi BTN VA v2.04 (autentikasi, signature, header, dan Create VA service 27), kontrak `openapi.yaml` gateway snap-va (endpoint token, Create VA, dan bulk), dokumen arsitektur gateway (alur Create VA dan bulk §4.2–4.3, canonicalization, dan adapter CBS), serta panduan pengujian Swagger gateway yang terverifikasi di sandbox (identitas partner uji, bentuk request Create VA aktual, nomor VA pada response, dan perilaku duplikat serta recycle). Di tempat kontrak generik dan implementasi aktual berbeda — nomor VA pada request Create VA, status akhir `ACTIVE`, dan bentuk bulk — dokumen ini mengikuti implementasi aktual dan menyebut perbedaannya di tempat.
