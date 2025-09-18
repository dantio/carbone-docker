const path = require(`path`);
const fs = require(`fs-extra`);
const util = require(`util`);
const carbone = require(`carbone`);
const {tmpdir} = require('os');
const crypto = require('crypto');
const fastify = require('fastify')({
  logger: true
});
const multer = require('fastify-multer');
const mkdirp = require('mkdirp');
const mimeTypes = require('mime-types');
const {replaceImages} = require('./images');

let maxFileSize = !isNaN(process.env.MAX_FILESIZE) ? parseInt(process.env.MAX_FILESIZE, 10) : 10000000; // 10 MB;
maxFileSize = maxFileSize === 0 ? Infinity : maxFileSize; // 10 MB;

const PORT = process.env.PORT || 3030;
const TEMP_DIR = tmpdir();
const TEMPLATES_DIR = process.env.TEMPLATES_DIR || './templates/';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(TEMP_DIR, 'carbone', 'uploads/');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    mkdirp.sync(UPLOAD_DIR);
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = file.originalname.split('.').pop() || '';
    cb(null, crypto.randomBytes(48).toString('base64url') + '.' + ext)
  }
});
const upload = multer({
  storage,
  limits: {
    fileSize: maxFileSize,
    files: 1
  }
});

const render = util.promisify(carbone.render);
const copyFile = util.promisify(fs.copyFile);
carbone.set({templatePath: TEMPLATES_DIR}); // With desired side effect to load translations

fastify.register(multer.contentParser)

if (process.env.DEMO) {
  fastify.get('/', (req, reply) => {
    fastify.log.info('Enable demo site')
    const stream = fs.createReadStream(path.resolve(`./demo/test.html`))
    reply.type('text/html').send(stream);
  });
}

fastify.head('/up', (req, reply) => {
  return { hello: 'ok' };
});

function getTemplatePath(req) {
  if (req.file) {
    return Promise.resolve(req.file.path);
  }

  const templateName = req.params.template;

  const templatePath = path.resolve(TEMPLATES_DIR, templateName);
  const ext = templatePath.split('.').pop() || '';
  mkdirp.sync(path.resolve(TEMP_DIR, 'carbone'));
  const dest = path.resolve(TEMP_DIR, 'carbone', crypto.randomBytes(48).toString('base64url') + '.' + ext);

  return copyFile(templatePath, dest).then(() => dest);
}


fastify.post('/render/:template?', {
  preHandler: upload.single('template')
}, async function (req, reply) {
  if (!req.file && !req.params.template) {
    return reply.status(400);
  }

  const templateName = req.file ? req.file.originalname : req.params.template;
  const options = getOptions(req.body.options, templateName);
  const data = getJson(req.body.data);
  const images = getJson(req.body.images, []);

  fastify.log.info({options}, 'Options')
  let report = null;
  let templatePath = null;
  try {
    templatePath = await getTemplatePath(req);
    await replaceImages(images, templatePath, fastify.log);
    report = await render(templatePath, data, options);
  } catch (e) {
    fastify.log.error(e);
    if (e.code && e.code === 'ENOENT') {
      return reply.status(404).send(`Template file not found.`);
    } else if (typeof e === 'string' && e.includes('Unknown input file type')) {
      return reply.status(415).send(e);
    }

    return reply.status(500).send(typeof e === 'string' ? e : e.message || 'Internal Server Error');
  } finally {
    if (templatePath) {
      fastify.log.info({templatePath}, 'Delete tmp file')
      fs.remove(templatePath);
    }
  }

  reply.header(`Content-Disposition`, `attachment; filename=${options.outputName}`);
  reply.header(`Content-Transfer-Encoding`, `binary`);
  reply.header(`Content-Type`, `application/octet-stream`);

  return reply.send(report);
});

function getOptions(optionsStr, templateName) {
  const originalNameWOExt = templateName
    .split(`.`)
    .slice(0, -1)
    .join(`.`);
  const originalFormat = templateName.split(`.`).reverse()[0];

  let options = getJson(optionsStr)

  options.convertTo = options.convertTo || originalFormat;
  options.outputName = options.outputName || `${originalNameWOExt}.${options.convertTo}`;

  return options;
}

function getJson(data, def = {}) {
  if (data && typeof data !== `object`) {
    try {
      return JSON.parse(data);
    } catch (e) {
      return {};
    }
  }
  return data || def;
}

const serve = async () => {
  try {
    await fastify.listen(PORT, '0.0.0.0');
    fastify.log.info({maxFileSize}, `Carbone wrapper listening on port ${PORT}!`)
  } catch (e) {
    fastify.log.error(e)
    process.exit(1);
  }
}

serve();