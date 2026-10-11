import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = [
    {
      name: 'Ca phe den',
      description: 'Ca phe den dam da, thom nong',
      imageUrl: 'https://placehold.co/300x200?text=Ca+phe+den',
      basePrice: 25000,
    },
    {
      name: 'Bac xiu',
      description: 'Ca phe sua nhe, ngot thanh',
      imageUrl: 'https://placehold.co/300x200?text=Bac+xiu',
      basePrice: 30000,
    },
    {
      name: 'Tra sua tran chau',
      description: 'Tra sua mat lanh kem tran chau den deo',
      imageUrl: 'https://placehold.co/300x200?text=Tra+sua',
      basePrice: 35000,
    },
    {
      name: 'Matcha latte',
      description: 'Matcha Nhat Ban pha cung sua tuoi beo ngay',
      imageUrl: 'https://placehold.co/300x200?text=Matcha',
      basePrice: 45000,
    },
    {
      name: 'Sinh to bo',
      description: 'Bo chin xay nhuyen cung sua dac',
      imageUrl: 'https://placehold.co/300x200?text=Sinh+to+bo',
      basePrice: 40000,
    },
  ];

  console.log('Seeding products...');
  for (const product of products) {
    await prisma.product.upsert({
      where: { id: products.indexOf(product) + 1 },
      update: {},
      create: product,
    });
  }
  console.log(`Seeded ${products.length} products successfully.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
