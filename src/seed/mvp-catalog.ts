export interface SeedFile {
  categories: Array<{ code: string; name: string; description?: string }>;
  products: Array<{
    name: string;
    description?: string;
    sku: string;
    barcode: string;
    categoryCode: string;
    sellingPrice: number;
    buyingPrice: number;
    baseUnit: string;
    tracksExpiry: boolean;
    promotionPrice?: number | null;
  }>;
}

type CategorySpec = {
  code: string;
  name: string;
  description: string;
  products: Array<[name: string, priceKes: number]>;
};

const categorySpecs: CategorySpec[] = [
  {
    code: "STAPLES", name: "Food staples", description: "Flour, grains, cooking essentials, and canned food",
    products: [
      ["Maize Flour 1kg", 115], ["Maize Flour 2kg", 210], ["Wheat Flour 1kg", 125], ["Wheat Flour 2kg", 225],
      ["White Sugar 1kg", 180], ["White Sugar 2kg", 345], ["Pishori Rice 1kg", 240], ["Pishori Rice 2kg", 465],
      ["Long Grain Rice 1kg", 190], ["Green Grams 1kg", 260], ["Yellow Beans 1kg", 230], ["Red Kidney Beans 1kg", 245],
      ["Table Salt 500g", 55], ["Iodized Salt 1kg", 95], ["Vegetable Cooking Oil 500ml", 195], ["Vegetable Cooking Oil 1L", 365],
      ["Vegetable Cooking Oil 2L", 710], ["Tomato Paste 400g", 175], ["Canned Baked Beans 420g", 190], ["Spaghetti 500g", 135],
    ],
  },
  {
    code: "BEVERAGES", name: "Beverages", description: "Water, juice, tea, coffee, and soft drinks",
    products: [
      ["Drinking Water 500ml", 50], ["Drinking Water 1L", 80], ["Drinking Water 1.5L", 110], ["Sparkling Water 500ml", 95],
      ["Orange Soda 300ml", 60], ["Orange Soda 500ml", 85], ["Cola Soda 300ml", 60], ["Cola Soda 500ml", 85],
      ["Lemon Lime Soda 500ml", 85], ["Mango Juice 1L", 260], ["Orange Juice 1L", 275], ["Apple Juice 1L", 290],
      ["Mixed Fruit Juice 500ml", 145], ["Black Tea Leaves 100g", 135], ["Black Tea Leaves 250g", 295], ["Instant Coffee 50g", 210],
      ["Instant Coffee 100g", 390], ["Drinking Chocolate 250g", 285], ["Energy Drink 250ml", 150], ["Malted Drink 500g", 620],
    ],
  },
  {
    code: "DAIRY", name: "Dairy and chilled", description: "Milk, yoghurt, cheese, margarine, and chilled products",
    products: [
      ["Fresh Milk 500ml", 65], ["Fresh Milk 1L", 120], ["Long Life Milk 500ml", 75], ["Long Life Milk 1L", 140],
      ["Mala Fermented Milk 500ml", 90], ["Mala Fermented Milk 1L", 170], ["Natural Yoghurt 150ml", 75], ["Vanilla Yoghurt 150ml", 80],
      ["Strawberry Yoghurt 250ml", 125], ["Vanilla Yoghurt 500ml", 210], ["Salted Butter 250g", 390], ["Margarine 250g", 170],
      ["Margarine 500g", 315], ["Cheddar Cheese 250g", 520], ["Cheddar Cheese Slices 200g", 475], ["Fresh Cream 250ml", 290],
      ["Vanilla Ice Cream 500ml", 380], ["Chocolate Ice Cream 500ml", 395], ["Free Range Eggs 6 Pack", 120], ["Free Range Eggs 12 Pack", 230],
    ],
  },
  {
    code: "SNACKS", name: "Snacks and confectionery", description: "Biscuits, crisps, sweets, nuts, and quick snacks",
    products: [
      ["Salted Potato Crisps 30g", 50], ["Salted Potato Crisps 100g", 145], ["Chilli Potato Crisps 100g", 150], ["Corn Puffs 50g", 65],
      ["Roasted Peanuts 100g", 95], ["Roasted Cashews 100g", 260], ["Digestive Biscuits 200g", 145], ["Glucose Biscuits 200g", 95],
      ["Cream Biscuits Vanilla 150g", 110], ["Cream Biscuits Chocolate 150g", 115], ["Milk Chocolate Bar 50g", 125], ["Dark Chocolate Bar 50g", 145],
      ["Fruit Sweets 100g", 95], ["Mint Sweets 100g", 100], ["Chewing Gum 10 Pack", 60], ["Caramel Popcorn 100g", 110],
      ["Salted Popcorn 100g", 95], ["Granola Bar 40g", 90], ["Beef Sausage Roll", 130], ["Cup Noodles Chicken 70g", 120],
    ],
  },
  {
    code: "HOUSEHOLD", name: "Household cleaning", description: "Laundry, dishwashing, surface cleaning, and home care",
    products: [
      ["Laundry Bar Soap 200g", 85], ["Laundry Bar Soap 800g", 270], ["Washing Powder 500g", 145], ["Washing Powder 1kg", 275],
      ["Washing Powder 2kg", 520], ["Dishwashing Liquid 250ml", 110], ["Dishwashing Liquid 500ml", 195], ["Dishwashing Liquid 1L", 340],
      ["Bleach 500ml", 120], ["Bleach 1L", 210], ["Multipurpose Cleaner 500ml", 230], ["Glass Cleaner 500ml", 265],
      ["Toilet Cleaner 500ml", 240], ["Floor Cleaner 1L", 330], ["Disinfectant 500ml", 280], ["Air Freshener 300ml", 360],
      ["Kitchen Sponge 3 Pack", 120], ["Steel Wool 6 Pack", 95], ["Garbage Bags 20 Pack", 240], ["Aluminium Foil 10m", 285],
    ],
  },
  {
    code: "PERSONAL", name: "Personal care", description: "Bathing, dental, hair, and everyday hygiene products",
    products: [
      ["Bathing Soap 100g", 85], ["Bathing Soap 175g", 135], ["Body Wash 500ml", 390], ["Body Lotion 200ml", 260],
      ["Body Lotion 400ml", 440], ["Petroleum Jelly 100ml", 155], ["Petroleum Jelly 250ml", 295], ["Toothpaste 70ml", 150],
      ["Toothpaste 140ml", 280], ["Medium Toothbrush", 120], ["Dental Floss 50m", 220], ["Shampoo 200ml", 290],
      ["Shampoo 400ml", 510], ["Hair Conditioner 400ml", 530], ["Roll-on Deodorant 50ml", 240], ["Aerosol Deodorant 150ml", 390],
      ["Sanitary Pads 8 Pack", 110], ["Sanitary Pads 16 Pack", 210], ["Pocket Tissues 10 Pack", 160], ["Toilet Tissue 4 Pack", 220],
    ],
  },
  {
    code: "PRODUCE", name: "Fresh produce", description: "Common fresh fruit and vegetables sold by retail pack",
    products: [
      ["Bananas 1kg", 180], ["Oranges 1kg", 220], ["Apples 1kg", 340], ["Mangoes 1kg", 250],
      ["Avocados 4 Pack", 200], ["Lemons 500g", 150], ["Watermelon Whole", 420], ["Pineapple Whole", 230],
      ["Tomatoes 1kg", 160], ["Red Onions 1kg", 190], ["White Potatoes 2kg", 280], ["Sweet Potatoes 1kg", 170],
      ["Carrots 1kg", 180], ["Cabbage Whole", 120], ["Sukuma Wiki Bunch", 40], ["Spinach Bunch", 45],
      ["Green Capsicum 500g", 190], ["Cucumber 500g", 130], ["Ginger 250g", 160], ["Garlic 250g", 180],
    ],
  },
  {
    code: "BAKERY", name: "Bakery", description: "Bread, cakes, pastries, and breakfast bakery items",
    products: [
      ["White Bread 400g", 65], ["White Bread 600g", 90], ["Brown Bread 400g", 75], ["Brown Bread 600g", 105],
      ["Wholemeal Bread 400g", 110], ["Milk Bread 400g", 95], ["Burger Buns 6 Pack", 180], ["Hot Dog Rolls 6 Pack", 175],
      ["Plain Scones 4 Pack", 140], ["Queen Cakes 6 Pack", 180], ["Vanilla Muffin", 90], ["Chocolate Muffin", 100],
      ["Plain Doughnut", 70], ["Chocolate Doughnut", 95], ["Mandazi 4 Pack", 100], ["Chapati 5 Pack", 180],
      ["Vanilla Cake 500g", 520], ["Chocolate Cake 500g", 580], ["Cookies 250g", 220], ["Bread Crumbs 250g", 145],
    ],
  },
  {
    code: "BABY", name: "Baby care", description: "Diapers, wipes, feeding, and baby hygiene essentials",
    products: [
      ["Newborn Diapers 24 Pack", 620], ["Small Diapers 40 Pack", 980], ["Medium Diapers 40 Pack", 1050], ["Large Diapers 36 Pack", 1080],
      ["Extra Large Diapers 32 Pack", 1120], ["Baby Wipes 40 Pack", 180], ["Baby Wipes 80 Pack", 320], ["Baby Petroleum Jelly 100ml", 170],
      ["Baby Lotion 200ml", 290], ["Baby Shampoo 200ml", 310], ["Baby Bath Soap 100g", 120], ["Baby Oil 200ml", 280],
      ["Infant Cereal 250g", 390], ["Infant Cereal 500g", 720], ["Feeding Bottle 250ml", 350], ["Silicone Pacifier", 220],
      ["Baby Bib 2 Pack", 260], ["Cotton Buds 100 Pack", 130], ["Cotton Wool 100g", 150], ["Changing Mat", 680],
    ],
  },
  {
    code: "STATIONERY", name: "Stationery", description: "School, office, till, and packaging supplies",
    products: [
      ["Blue Ballpoint Pen", 25], ["Black Ballpoint Pen", 25], ["Red Ballpoint Pen", 25], ["HB Pencil", 20],
      ["Pencil Eraser", 15], ["Pencil Sharpener", 25], ["A5 Exercise Book 80 Page", 70], ["A4 Exercise Book 120 Page", 145],
      ["A4 Counter Book 2 Quire", 360], ["A4 Copier Paper 500 Sheets", 780], ["Permanent Marker Black", 100], ["Whiteboard Marker Blue", 110],
      ["Highlighter Yellow", 90], ["Clear Adhesive Tape", 85], ["Masking Tape", 140], ["Glue Stick 20g", 100],
      ["Stapler Small", 280], ["Staples 1000 Pack", 90], ["Receipt Paper Roll 80mm", 120], ["Brown Envelopes A4 10 Pack", 180],
    ],
  },
];

const ean13 = (itemNumber: number) => {
  const firstTwelve = `616${String(itemNumber).padStart(9, "0")}`;
  const sum = [...firstTwelve].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${firstTwelve}${(10 - (sum % 10)) % 10}`;
};

export const buildMvpSeed = (): SeedFile => {
  let productNumber = 1;
  return {
    categories: categorySpecs.map(({ code, name, description }) => ({ code, name, description })),
    products: categorySpecs.flatMap((category) => category.products.map(([name, price]) => {
      const index = productNumber++;
      const costRatio = 0.68 + (index % 10) * 0.012;
      return {
        name,
        description: `${name} retail inventory item`,
        sku: `${category.code.slice(0, 4)}-${String(index).padStart(4, "0")}`,
        barcode: ean13(index),
        categoryCode: category.code,
        sellingPrice: price,
        buyingPrice: Math.round(price * costRatio),
        baseUnit: "each",
        tracksExpiry: ["STAPLES", "BEVERAGES", "DAIRY", "PRODUCE", "BAKERY", "BABY"].includes(category.code),
        promotionPrice: index % 10 === 0 ? Math.max(1, Math.round(price * 0.9)) : null,
      };
    })),
  };
};
