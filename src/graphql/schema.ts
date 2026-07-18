export const typeDefs = `#graphql
  # Types
  type User {
    id: ID!
    username: String!
    email: String!
    name: String!
    role: String!
    roles: [String!]!
    status: String!
    emailVerified: Boolean!
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
    inviteUser(email: String!, name: String!, roles: [String!]!): User!
    resendUserInvitation(username: String!): User!
    updateUserRoles(username: String!, roles: [String!]!): User!
    setUserEnabled(username: String!, enabled: Boolean!): User!

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
