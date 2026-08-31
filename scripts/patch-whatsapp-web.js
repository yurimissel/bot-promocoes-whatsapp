#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dependencyRoot = path.join(root, 'node_modules', 'whatsapp-web.js', 'src');

function replaceOnce(file, before, after, label) {
  const filePath = path.join(dependencyRoot, file);
  let source = fs.readFileSync(filePath, 'utf8');

  if (source.includes(after)) return false;
  if (!source.includes(before)) {
    throw new Error(`Não foi possível aplicar a correção "${label}" em ${file}.`);
  }

  source = source.replace(before, after);
  fs.writeFileSync(filePath, source);
  return true;
}

function main() {
  if (!fs.existsSync(dependencyRoot)) {
    throw new Error('whatsapp-web.js não está instalado. Execute npm ci antes desta correção.');
  }

  const changes = [];
  const apply = (file, before, after, label) => {
    if (replaceOnce(file, before, after, label)) changes.push(label);
  };

  apply(
    'util/Injected/Utils.js',
    'exports.LoadUtils = () => {\n    window.WWebJS = {};',
    `exports.LoadUtils = () => {
    window.WWebJS = {};

    // WA Web 2.3000.x renamed MsgKey._serialized to MsgKey.$1.
    // Restoring the getter in the browser context repairs all page-side lookups.
    try {
        const MsgKey = window.require('WAWebMsgKey');
        const prototype = MsgKey && MsgKey.prototype;
        if (
            prototype &&
            !Object.getOwnPropertyDescriptor(prototype, '_serialized')
        ) {
            Object.defineProperty(prototype, '_serialized', {
                configurable: true,
                get() {
                    return this.$1;
                },
            });
        }
    } catch (ignoredError) {
        // The explicit fallbacks below remain active if the prototype is unavailable.
    }`,
    'getter compatível do MsgKey'
  );

  apply(
    'util/Injected/Utils.js',
    `.Msg.get(newMsgKey._serialized);`,
    `.Msg.get(newMsgKey._serialized || newMsgKey.$1);`,
    'retorno do envio'
  );

  apply(
    'util/Injected/Utils.js',
    `return window.require('WAWebCollections').Msg.get(msg.id._serialized);`,
    `return window
            .require('WAWebCollections')
            .Msg.get(msg.id._serialized || msg.id.$1);`,
    'retorno da edição'
  );

  apply(
    'util/Injected/Utils.js',
    `remote: msg.id.remote._serialized,`,
    `remote: msg.id.remote._serialized || msg.id.remote.$1,`,
    'destino serializado da mensagem'
  );

  apply(
    'util/Injected/Utils.js',
    `        delete msg.pendingAckUpdate;`,
    `        if (msg.id && msg.id._serialized == null && msg.id.$1 != null) {
            msg.id = Object.assign({}, msg.id, { _serialized: msg.id.$1 });
        }

        delete msg.pendingAckUpdate;`,
    'normalização da mensagem enviada ao Node.js'
  );

  apply(
    'util/Injected/Utils.js',
    `.createWid(chat.id._serialized);`,
    `.createWid(chat.id._serialized || chat.id.$1);`,
    'identificador do grupo'
  );

  apply(
    'util/Injected/Utils.js',
    `        model.lastMessage = null;
        if (model.msgs && model.msgs.length) {
            const lastMessage = chat.lastReceivedKey
                ? window
                      .require('WAWebCollections')
                      .Msg.get(chat.lastReceivedKey._serialized) ||
                  (
                      await window
                          .require('WAWebCollections')
                          .Msg.getMessagesById([
                              chat.lastReceivedKey._serialized,
                          ])
                  )?.messages?.[0]
                : null;`,
    `        model.lastMessage = null;
        if (model.msgs && model.msgs.length) {
            const lastReceivedKey = chat.lastReceivedKey
                ? chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1
                : null;
            const lastMessage = lastReceivedKey
                ? window.require('WAWebCollections').Msg.get(lastReceivedKey) ||
                  (
                      await window
                          .require('WAWebCollections')
                          .Msg.getMessagesById([lastReceivedKey])
                  )?.messages?.[0]
                : null;`,
    'última mensagem do grupo'
  );

  apply(
    'structures/Base.js',
    `    _patch(data) {
        return data;
    }
}`,
    `    _patch(data) {
        return data;
    }

    static _normalizeId(id) {
        if (id && id._serialized == null && id.$1 != null) {
            return Object.assign({}, id, { _serialized: id.$1 });
        }
        return id;
    }
}`,
    'normalização central de IDs'
  );

  apply(
    'structures/Message.js',
    `        this.id = data.id;`,
    `        this.id = Base._normalizeId(data.id);`,
    'ID da estrutura Message'
  );

  apply(
    'structures/Message.js',
    `? data.from._serialized
                : data.from;`,
    `? (data.from._serialized || data.from.$1)
                : data.from;`,
    'remetente da mensagem'
  );

  apply(
    'structures/Message.js',
    `? data.to._serialized
                : data.to;`,
    `? (data.to._serialized || data.to.$1)
                : data.to;`,
    'destinatário da mensagem'
  );

  apply(
    'structures/Message.js',
    `? data.author._serialized
                : data.author;`,
    `? (data.author._serialized || data.author.$1)
                : data.author;`,
    'autor da mensagem'
  );

  apply(
    'structures/Chat.js',
    `        this.id = data.id;`,
    `        this.id = Base._normalizeId(data.id);`,
    'ID da estrutura Chat'
  );

  process.stdout.write(
    changes.length
      ? `Compatibilidade do WhatsApp Web aplicada (${changes.length} ajustes).\n`
      : 'Compatibilidade do WhatsApp Web já estava aplicada.\n'
  );
}

main();
