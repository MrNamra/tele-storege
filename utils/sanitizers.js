const sanitizeFileId = (fileId) => {
    if (typeof fileId === 'string') {
        return fileId.replace(/[^a-zA-Z0-9_-]/g, '');
    }
    return '';
};

module.exports = { sanitizeFileId };