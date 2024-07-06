const fs = require("fs");
const cluster = require("cluster");
var CoinKey = require("coinkey");
const { default: axios } = require("axios");
const crypto = require("crypto");
const blessed = require('blessed');

const getRandomBigIntInRange = (min, max) => {
  const minBigInt = BigInt(min);
  const maxBigInt = BigInt(max);

  // Determine the range size
  const range = maxBigInt - minBigInt + 1n;

  // Calculate the number of bytes needed to represent the range
  const bytesNeeded = Math.ceil(range.toString(16).length / 2);

  let randomBigInt;
  do {
    // Generate random bytes
    const randomBuffer = crypto.randomBytes(bytesNeeded);

    // Convert the buffer to a BigInt
    randomBigInt = BigInt('0x' + randomBuffer.toString('hex'));

    // Ensure the randomBigInt is within the range [0, range - 1]
    randomBigInt = randomBigInt % range;

    // Retry if randomBigInt is greater than the maximum possible value within the range
  } while (randomBigInt >= range);

  // Adjust to the desired range and add minBigInt
  const result = minBigInt + randomBigInt;

  return result;
}

const generateRandomPrivateKey = (min, max) => {
  const key = getRandomBigIntInRange(min, max);
  return key.toString(16)
}

const splitRange = (start, end, numCpus) => {
  const startBigInt = BigInt(start);
  const endBigInt = BigInt(end);

  // Calculate the total range
  const totalRange = endBigInt - startBigInt;

  // Calculate the range per CPU
  const rangePerCpu = totalRange / BigInt(numCpus);

  // Generate the sub-ranges
  const subRanges = [];

  for (let i = 0; i < numCpus; i++) {
    const subRangeStart = startBigInt + rangePerCpu * BigInt(i);
    let subRangeEnd;
    if (i === numCpus - 1) { // Last range goes to the end
      subRangeEnd = endBigInt;
    } else {
      subRangeEnd = subRangeStart + rangePerCpu - BigInt(1);
    }
    subRanges.push([subRangeStart.toString(16), subRangeEnd.toString(16)]); // Convert to hexadecimal
  }

  return subRanges;
}

(async () => {
  if (cluster.isMaster) {
    const numCPUs = 8;
    const source = {
      start: '0000000000000000000000000000000000000000000000100000000000000000',
      end: '00000000000000000000000000000000000000000000001fffffffffffffffff',
      target: '19vkiEajfhuZ8bs8Zu2jgmC6oqZbWqhxhG'
    }
    const ranges = splitRange(`0x${source.start}`, `0x${source.end}`, numCPUs);

    let total = ranges.reduce((a, b) => ({ ...a, [b[0]]: 0 }), {});
    let lines = ranges.reduce((a, b) => ({ ...a, [b[0]]: null }), {});
    let currents = ranges.reduce((a, b) => ({ ...a, [b[0]]: null }), {});
    let screen = blessed.screen({ smartCSR: true });

    ranges.forEach((r, i) => {
      const [s, e] = r;
      let line = blessed.text({
        top: 0 + (i * 2),
        left: 0,
        width: '100%',
        height: 'shrink',
        content: `[0] ${s} - ${e} ~~> address:private`,
        style: {
          fg: 'green'
        }
      });
      lines[s] = line;
      screen.append(line);
    })

    const box = blessed.box({
      top: ranges.length * 2 + 1,
      left: 0,
      width: '100%',
      height: '40%',
      content: "",
      border: {
        type: 'line'
      },
      label: ` Found Wallets: ${source.target} `,
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


      const { start, end, current, count } = message;
      const line = lines[start];
      total[start] += count;
      if (current) currents[start] = current;

      line.setContent(`[${total[start]}] ${start} - ${end} ~~> ${currents[start]?.address}:${currents[start]?.baseKey}`);
      screen.render();
    });

    for (let i = 0; i < numCPUs; i++) {
      const [rangeStart, rangeEnd] = ranges[i];

      cluster.fork({
        RANGES: JSON.stringify(ranges),
        START_KEY: rangeStart,
        END_KEY: rangeEnd,
        TARGET: source.target
      });
    }

    cluster.on("exit", (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} died`);
    });
  } else {
    const BASE_START_KEY = process.env.START_KEY;
    const BASE_END_KEY = process.env.END_KEY;
    const START_KEY = BigInt(`0x${BASE_START_KEY}`);
    const END_KEY = BigInt(`0x${BASE_END_KEY}`);
    const TARGET = process.env.TARGET;

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

    const generateWallet = async () => new Promise((resolve) => {
      const baseKey = generateRandomPrivateKey(START_KEY, END_KEY);
      const privateKey = baseKey.padStart(64, '0');
      const address = createWallet(privateKey);
      resolve({ address, privateKey, baseKey, matched: address == TARGET });
    })

    const createWallets = async (num) =>
      new Promise(async (resolve) => {
        const processes = Array(num).fill(0).map(async () => await generateWallet().then(async (item) => {
          if (item.matched) {
            item.balance = 1;
            process.send({ found: true, ...item });
            saveLog(item);
            await notify(item.address, item.privateKey);
          }

          return item;
        }));

        const wallets = await Promise.all(processes);
        const current = wallets.find(o => o.address.startsWith('19vk')) || null;
        resolve({ start: BASE_START_KEY, end: BASE_END_KEY, current, count: wallets.length });
      });

    const processBatch = async () => {
      const processes = Array(2).fill(0).map(() => createWallets(10000).then(w => {
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
