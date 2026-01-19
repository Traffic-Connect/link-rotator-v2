// MongoDB initialization script
db = db.getSiblingDB('link_rotator');

// Создаем индексы для оптимизации
db.links.createIndex({ "key": 1 }, { unique: true });
db.links.createIndex({ "userId": 1, "createdAt": -1 });
db.links.createIndex({ "userId": 1, "isActive": 1 });
db.links.createIndex(
    { "cloudflare.credential": 1, "cloudflare.link": 1 },
    {
        unique: true,
        partialFilterExpression: {
            "cloudflare.enabled": true,
            "cloudflare.credential": { $exists: true },
            "cloudflare.link": { $exists: true }
        }
    }
);

db.clicks.createIndex({ "linkId": 1, "createdAt": -1 });
db.clicks.createIndex({ "redirectId": 1, "createdAt": -1 });
db.clicks.createIndex({ "createdAt": -1 });

db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "isActive": 1 });

db.cloudflarecredentials.createIndex({ "apiToken": 1 }, { unique: true });
db.cloudflarecredentials.createIndex({ "login": 1, "accountId": 1 }, { unique: true });

db.subdomains.createIndex({ "subdomain": 1, "domain": 1 }, { unique: true });
db.subdomains.createIndex({ "fqdn": 1 }, { unique: true });

print("MongoDB indexes created");

// Создаем администратора
// ВАЖНО: Пароль будет захеширован при первом входе через API
// Здесь мы создаем временную запись, которую нужно будет обновить
const adminEmail = "adminseo@trafficconnect.com";

// Проверяем, существует ли уже администратор
const existingAdmin = db.users.findOne({ email: adminEmail });

if (!existingAdmin) {
    // Bcrypt hash для пароля "m9OviUHdCOKM" (10 rounds)
    // Сгенерирован заранее: bcrypt.hashSync('m9OviUHdCOKM', 10)
    const hashedPassword = "$2a$10$ezrKIEedBT7OBnUua/wfc.q.AJc9kDCKR8VnS0Tvx7cgrQG4ns3wO";

    db.users.insertOne({
        name: "Admin SEO",
        email: adminEmail,
        password: hashedPassword,
        role: "admin",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLogin: null
    });

    print("✅ Admin user created:");
    print("   Email: " + adminEmail);
    print("   Password: m9OviUHdCOKM");
    print("   Role: admin");
} else {
    print("ℹ️  Admin user already exists, skipping creation");
}

print("MongoDB initialization completed successfully");
