'use strict';

function isValidRoomName(input) {
    if (typeof input !== 'string') {
        return false;
    }
    const pattern =
        /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|[A-Za-z0-9-_]+)$/;
    return pattern.test(input);
}

function isValidRecFileNameFormat(input) {
    if (typeof input !== 'string') {
        return false;
    }
    const pattern =
        /^Rec_(?:[A-Za-z0-9-_]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}\.(webm)$/;
    return pattern.test(input);
}

module.exports = {
    isValidRoomName,
    isValidRecFileNameFormat,
};
