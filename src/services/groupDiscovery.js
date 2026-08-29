const logger = require('../utils/logger');

function serializedId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value._serialized === 'string') return value._serialized;
  if (typeof value.$1 === 'string') return value.$1;
  if (value.user && value.server) return `${value.user}@${value.server}`;
  return '';
}

function isGroupId(id) {
  return typeof id === 'string' && id.endsWith('@g.us');
}

function participantCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value.getModelsArray === 'function') {
    try { return value.getModelsArray().length; } catch (_) { return null; }
  }
  if (value && Number.isFinite(value.length)) return Number(value.length);
  return null;
}

function normalizeGroup(group, source = 'cache') {
  const id = serializedId(group.id || group.wid || group);
  if (!isGroupId(id)) return null;

  const metadata = group.groupMetadata || group.metadata || {};
  const name = group.name
    || group.formattedTitle
    || group.subject
    || metadata.subject
    || (group.contact && (group.contact.name || group.contact.pushname))
    || id;
  const participants = participantCount(
    group.participants || metadata.participants
  );

  return {
    id,
    name: String(name || id),
    participants,
    source,
  };
}

function mergeGroup(map, group) {
  if (!group) return;
  const existing = map.get(group.id);
  if (!existing) {
    map.set(group.id, group);
    return;
  }
  if (existing.name === existing.id && group.name !== group.id) existing.name = group.name;
  if (!existing.participants && group.participants) existing.participants = group.participants;
  if (existing.source !== 'whatsapp' && group.source === 'whatsapp') existing.source = 'whatsapp';
}

async function rawBrowserGroups(client) {
  if (!client.pupPage || typeof client.pupPage.evaluate !== 'function') return [];

  return client.pupPage.evaluate(() => {
    const serialize = (value) => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value._serialized === 'string') return value._serialized;
      if (typeof value.$1 === 'string') return value.$1;
      if (value.user && value.server) return `${value.user}@${value.server}`;
      return '';
    };

    const count = (participants) => {
      try {
        if (Array.isArray(participants)) return participants.length;
        if (participants && typeof participants.getModelsArray === 'function') {
          return participants.getModelsArray().length;
        }
        if (participants && Number.isFinite(participants.length)) return participants.length;
      } catch (_) {
        return null;
      }
      return null;
    };

    const result = new Map();
    const add = (model, kind) => {
      if (!model) return;
      const idObject = model.id || model.wid || model.groupMetadata?.id;
      const id = serialize(idObject);
      const server = idObject && idObject.server;
      if (!(id.endsWith('@g.us') || server === 'g.us')) return;

      const metadata = model.groupMetadata || model.metadata || model;
      const name = model.formattedTitle
        || model.name
        || model.subject
        || metadata.subject
        || model.contact?.name
        || model.contact?.pushname
        || id;
      const participants = count(metadata.participants || model.participants);
      const existing = result.get(id);
      if (!existing || existing.name === id) {
        result.set(id, { id, name: String(name || id), participants, kind });
      } else if (!existing.participants && participants) {
        existing.participants = participants;
      }
    };

    try {
      const collections = window.require('WAWebCollections');
      const sources = [
        ['chat', collections.Chat],
        ['contact', collections.Contact],
        ['metadata', collections.GroupMetadata || collections.WAWebGroupMetadataCollection],
      ];
      for (const [kind, collection] of sources) {
        const models = collection && typeof collection.getModelsArray === 'function'
          ? collection.getModelsArray()
          : [];
        for (const model of models || []) add(model, kind);
      }
    } catch (_) {
      // Os métodos oficiais abaixo continuam disponíveis como fallback.
    }

    return [...result.values()];
  });
}

async function discoverGroups(client, customGroups = []) {
  const map = new Map();
  const warnings = [];
  let connectionState = null;

  try {
    connectionState = await client.getState();
  } catch (error) {
    warnings.push(`state: ${error.message}`);
  }

  if (connectionState !== 'CONNECTED') {
    return { groups: [], state: connectionState, warnings };
  }

  try {
    await client.sendPresenceAvailable();
  } catch (_) {
    // A presença não é necessária para a descoberta.
  }

  try {
    const rawGroups = await rawBrowserGroups(client);
    rawGroups.forEach((group) => mergeGroup(map, normalizeGroup(group, 'whatsapp')));
  } catch (error) {
    warnings.push(`browser: ${error.message}`);
  }

  try {
    const chats = await client.getChats();
    chats.forEach((chat) => mergeGroup(map, normalizeGroup(chat, 'whatsapp')));
  } catch (error) {
    warnings.push(`chats: ${error.message}`);
  }

  try {
    const contacts = await client.getContacts();
    contacts.forEach((contact) => {
      if (contact.isGroup || isGroupId(serializedId(contact.id))) {
        mergeGroup(map, normalizeGroup(contact, 'whatsapp'));
      }
    });
  } catch (error) {
    warnings.push(`contacts: ${error.message}`);
  }

  for (const configured of customGroups) {
    const id = serializedId(configured.id || configured);
    if (!isGroupId(id)) continue;
    let resolved = null;
    try {
      const chat = await client.getChatById(id);
      resolved = normalizeGroup(chat, 'manual');
    } catch (error) {
      warnings.push(`manual ${id}: ${error.message}`);
    }
    mergeGroup(map, resolved || {
      id,
      name: configured.name || id,
      participants: null,
      source: 'manual',
    });
  }

  const groups = [...map.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
  );

  logger.info(`[WhatsApp] Sincronização encontrou ${groups.length} grupo(s).`);
  if (warnings.length) logger.warn('[WhatsApp] Avisos na sincronização:', warnings.join(' | '));

  return { groups, state: connectionState, warnings };
}

module.exports = {
  discoverGroups,
  rawBrowserGroups,
  serializedId,
  isGroupId,
  normalizeGroup,
};
