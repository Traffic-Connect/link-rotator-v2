const mongoose = require('mongoose');

const subdomainSchema = new mongoose.Schema({
    subdomain: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    domain: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    fqdn: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true
    },
    zoneId: {
        type: String,
        required: true,
        trim: true
    },
    zoneName: {
        type: String,
        trim: true
    },
    dnsRecordId: {
        type: String,
        required: true,
        trim: true
    },
    dnsRecordType: {
        type: String,
        required: true,
        trim: true
    },
    dnsContent: {
        type: String,
        required: true,
        trim: true
    },
    ttl: {
        type: Number,
        default: 1
    },
    proxied: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

subdomainSchema.index({ subdomain: 1, domain: 1 }, { unique: true });

const Subdomain = mongoose.model('Subdomain', subdomainSchema);

module.exports = Subdomain;
