export const typeDefs = `#graphql
  # Types
  type User {
    id: ID!
    email: String!
    name: String!
    role: String!
    createdAt: String!
    updatedAt: String!
  }

  type Product {
    id: ID!
    name: String!
    description: String!
    price: Float!
    cost: Float!
    sku: String!
    category: String!
    stock: Int!
    minStock: Int!
    maxStock: Int!
    imageUrl: String
    status: String!
    createdAt: String!
    updatedAt: String!
  }

  type OrderItem {
    productId: ID!
    productName: String!
    quantity: Int!
    price: Float!
    total: Float!
  }

  type Order {
    id: ID!
    orderNumber: String!
    customerId: ID
    customerName: String!
    items: [OrderItem!]!
    totalAmount: Float!
    tax: Float!
    discount: Float!
    subtotal: Float!
    status: String!
    paymentMethod: String!
    paymentStatus: String!
    createdBy: String!
    createdAt: String!
    updatedAt: String!
  }

  type Customer {
    id: ID!
    name: String!
    email: String!
    phone: String!
    address: String!
    totalSpent: Float!
    orders: Int!
    createdAt: String!
    updatedAt: String!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type Query {
    # User queries
    me: User
    users: [User!]!
    user(id: ID!): User

    # Product queries
    products: [Product!]!
    product(id: ID!): Product
    productsByCategory(category: String!): [Product!]!

    # Order queries
    orders: [Order!]!
    order(id: ID!): Order
    ordersByCustomer(customerId: ID!): [Order!]!
    todayOrders: [Order!]!

    # Customer queries
    customers: [Customer!]!
    customer(id: ID!): Customer
  }

  type Mutation {
    # User mutations
    register(
      email: String!
      password: String!
      name: String!
      role: String!
    ): AuthPayload!
    login(email: String!, password: String!): AuthPayload!

    # Product mutations
    createProduct(
      name: String!
      description: String!
      price: Float!
      cost: Float!
      sku: String!
      category: String!
      stock: Int!
      minStock: Int!
      maxStock: Int!
    ): Product!

    updateProduct(
      id: ID!
      name: String
      description: String
      price: Float
      cost: Float
      stock: Int
      minStock: Int
      maxStock: Int
      status: String
    ): Product!

    deleteProduct(id: ID!): Boolean!

    # Order mutations
    createOrder(
      customerId: ID
      customerName: String!
      items: [OrderItemInput!]!
      paymentMethod: String!
    ): Order!

    updateOrderStatus(id: ID!, status: String!): Order!
    cancelOrder(id: ID!): Order!

    # Customer mutations
    createCustomer(
      name: String!
      email: String!
      phone: String!
      address: String!
    ): Customer!

    updateCustomer(
      id: ID!
      name: String
      email: String
      phone: String
      address: String
    ): Customer!
  }

  input OrderItemInput {
    productId: ID!
    quantity: Int!
    price: Float!
  }
`;
