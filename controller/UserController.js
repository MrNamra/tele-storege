const dashboard = (req, res) => {
    res.send('Dashboard');
}

const upload = (req, res) => {
    res.send('Upload');
}

const download = (req, res) => {
    res.send('Download');
}

const downloadFile = (req, res) => {
    res.send('Download File');
}

module.exports = {
    dashboard,
    upload
}